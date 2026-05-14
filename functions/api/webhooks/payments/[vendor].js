/**
 * POST /api/webhooks/payments/:vendor
 *
 * Phase F-2 — vendor-agnostic 金流 webhook 入口。
 *
 * 流程（鏡射 KYC webhook）：
 *   1. resolvePaymentAdapter(vendor) → 找 adapter
 *   2. adapter.parseWebhook → 驗章 + normalized payload
 *   3. dedupe：(vendor, event_id) UNIQUE → 200 deduplicated
 *   4. 找 payment_intent（先用 vendor_intent_id，沒有就 INSERT 一筆 row）
 *   5. updatePaymentStatus + critical audit
 *
 * Why critical audit：金流狀態改變影響餘額 / 提款 / 對帳，每筆都要可追溯。
 *
 * 回傳：
 *   200 → { ok: true, deduplicated?: boolean }
 *   400 → vendor 不認識
 *   401 → 簽章驗證失敗
 */

import { res } from '../../../utils/auth.js'
import {
  resolvePaymentAdapter, getPaymentIntent, createPaymentIntent, updatePaymentStatus,
  PAYMENT_KIND,
} from '../../../utils/payments.js'
import { safeUserAudit } from '../../../utils/user-audit.js'
import { DEBUG_REASON_CODES } from '../../../utils/audit-aggregate-debug.js'

export async function onRequestPost({ request, env, params }) {
  const vendor = String(params?.vendor ?? '').toLowerCase()
  const adapter = resolvePaymentAdapter(vendor)
  if (!adapter) {
    return res({ error: `Unknown payment vendor: ${vendor}`, code: 'UNKNOWN_PAYMENT_VENDOR', vendor }, 400)
  }

  // T17 DLQ：讀 raw body 一次（adapter 可能也會讀），失敗時落 DLQ
  const rawBody = await request.clone().text().catch(() => null)

  const parsed = await adapter.parseWebhook(request, env)

  // success/dedup 都要照 vendor 規格回（ECPay 要 plain text "1|OK"，否則 retry）
  const successFn = typeof adapter.successResponse === 'function'
    ? (extra) => adapter.successResponse(extra)
    : (extra = {}) => res({ ok: true, ...(extra.deduplicated ? { deduplicated: true } : {}) })

  if (!parsed.ok) {
    await safeUserAudit(env, {
      event_type: 'payment.webhook.fail', severity: 'warn', request,
      // reason_code = PR 3.1d 穩定 bucket key（codex M-1）；raw parser error 留 reason 欄不參與分群
      data: { vendor, reason_code: DEBUG_REASON_CODES.WEBHOOK_PARSE_FAILED, reason: parsed.error },
    })
    await dlqInsert(env, {
      vendor,
      raw_body: rawBody,
      error_stage: 'parse',
      error_message: parsed.error || 'parse failed',
      http_status_returned: 401,
    })
    if (typeof adapter.failureResponse === 'function') {
      return adapter.failureResponse(parsed.error)
    }
    return res({ error: 'Webhook validation failed', code: 'WEBHOOK_VALIDATION_FAILED' }, 401)
  }

  // 找對應的 intent — 從這裡之後任何 throw 都進 DLQ
  // Codex r1 P0-1：includeDeleted=true 才看得到 soft-deleted row → orphan 偵測（見下方）
  let intent
  try {
    intent = await getPaymentIntent(env, { vendor, vendor_intent_id: parsed.vendor_intent_id, includeDeleted: true })
  } catch (e) {
    await dlqInsert(env, {
      vendor,
      event_id: parsed.event_id,
      vendor_intent_id: parsed.vendor_intent_id,
      raw_body: rawBody,
      error_stage: 'lookup_intent',
      error_message: String(e?.message || e).slice(0, 1000),
      http_status_returned: 500,
    })
    throw e
  }

  // 金額/幣別校驗：webhook 帶的金額必須跟原 intent 一致，否則視為攻擊或 PSP 異常。
  // Why：簽章 + 金額雙閘門。簽章密鑰若外洩，至少擋住「拿低額 intent 偽造高額成功」這條鏈。
  // 注意：PSP-direct 流程（intent 還不存在）暫無從比對，跳過；建出來的 intent 直接以
  // webhook 金額為準（沒有原值可對拍）。
  // Codex r1 P0-1：soft-deleted intent 走下方 orphan 分支（不在此驗金額）
  if (intent && !intent.deleted_at && parsed.amount_subunit != null && intent.amount_subunit != null) {
    const amountOk   = Number(parsed.amount_subunit) === Number(intent.amount_subunit)
    const currencyOk = !parsed.currency || !intent.currency
                       || String(parsed.currency).toUpperCase() === String(intent.currency).toUpperCase()
    if (!amountOk || !currencyOk) {
      await safeUserAudit(env, {
        event_type: 'payment.webhook.amount_mismatch',
        severity:   'critical',
        user_id:    intent.user_id ?? null,
        request,
        data: {
          vendor,
          event_id:         parsed.event_id,
          vendor_intent_id: parsed.vendor_intent_id,
          intent_id:        intent.id,
          expected_amount:  intent.amount_subunit,
          got_amount:       parsed.amount_subunit,
          expected_currency: intent.currency,
          got_currency:     parsed.currency ?? null,
        },
      })
      // P1-11：amount_mismatch 不回 failure（否則 PSP 會 retry 3 次 → 灌爆 DLQ +
      // critical Discord 連發）。已寫 critical audit + DLQ 留存證據；intent 維持原狀
      // （不更新 status，避免被偽造金額污染），對 PSP 回 success 結束 retry。
      await dlqInsert(env, {
        vendor,
        event_id: parsed.event_id,
        vendor_intent_id: parsed.vendor_intent_id,
        raw_body: rawBody,
        error_stage: 'amount_mismatch',
        error_message: `expected ${intent.amount_subunit} ${intent.currency}, got ${parsed.amount_subunit} ${parsed.currency ?? '?'}`,
        http_status_returned: 200,
      })
      return successFn()
    }
  }

  // dedupe + single-applier claim —
  //   Codex r1 P0-2：apply_status 三態避免「event dedupe 但狀態未套用」漂移
  //   Codex r2 P1：撞到別人正 'processing' 不能跟著雙跑 → 回 PSP failure 讓 retry
  // 規則：
  //   - fresh INSERT changes===1  → 我是 owner，繼續處理
  //   - 既有 'applied'             → 真 dedup hit，直接 success
  //   - 既有 'failed'              → CAS UPDATE 'failed'→'processing' 才算 claim 到 retry
  //   - 既有 'processing'（in-flight）/ CAS 落敗 → 回 failure，PSP 之後 retry（不雙跑）
  const payloadHash = parsed.raw_body
    ? await sha256Hex(parsed.raw_body).catch(() => null)
    : null
  let claimed = false
  try {
    const insertRes = await env.chiyigo_db
      .prepare(
        `INSERT OR IGNORE INTO payment_webhook_events
           (vendor, event_id, intent_id, user_id, status_to, payload_hash, apply_status)
         VALUES (?, ?, ?, ?, ?, ?, 'processing')`,
      )
      .bind(vendor, parsed.event_id,
            intent?.id ?? null,
            parsed.user_id ?? intent?.user_id ?? null,
            parsed.status, payloadHash)
      .run()

    if ((insertRes?.meta?.changes ?? 0) === 1) {
      claimed = true
    } else {
      const existing = await env.chiyigo_db
        .prepare(`SELECT apply_status FROM payment_webhook_events WHERE vendor = ? AND event_id = ?`)
        .bind(vendor, parsed.event_id).first()

      if (existing?.apply_status === 'applied') {
        return successFn({ deduplicated: true })
      }
      if (existing?.apply_status === 'failed') {
        const cas = await env.chiyigo_db
          .prepare(
            `UPDATE payment_webhook_events
               SET apply_status='processing', processed_at=datetime('now')
             WHERE vendor=? AND event_id=? AND apply_status='failed'`,
          )
          .bind(vendor, parsed.event_id).run()
        if ((cas?.meta?.changes ?? 0) === 1) claimed = true
        // CAS 落敗（被別人搶先）→ fall through 到 in-flight 處理
      }
    }
  } catch (e) {
    await dlqInsert(env, {
      vendor,
      event_id: parsed.event_id,
      vendor_intent_id: parsed.vendor_intent_id,
      raw_body: rawBody,
      payload_hash: payloadHash,
      error_stage: 'dedupe_claim',
      error_message: String(e?.message || e).slice(0, 1000),
      http_status_returned: 500,
    })
    throw e
  }

  if (!claimed) {
    // in-flight conflict：另一個 instance 正在跑同 event_id，回 failure 讓 PSP retry
    await safeUserAudit(env, {
      event_type: 'payment.webhook.in_flight_conflict',
      severity:   'warn',
      request,
      data: { vendor, reason_code: DEBUG_REASON_CODES.IN_FLIGHT_CONFLICT, event_id: parsed.event_id, vendor_intent_id: parsed.vendor_intent_id },
    })
    if (typeof adapter.failureResponse === 'function') {
      return adapter.failureResponse('in-flight processing; retry later')
    }
    return res({ error: 'Event in-flight; retry later', code: 'WEBHOOK_IN_FLIGHT' }, 409)
  }

  // Codex r5 P0：orphan 處理共用 helper（dedupe claim 後 upfront + 下方 TOCTOU 補救都用）。
  async function handleOrphan({ liveIntent, reason }) {
    await safeUserAudit(env, {
      event_type: 'payment.webhook.orphan_intent',
      severity:   'critical',
      user_id:    liveIntent?.user_id ?? null,
      request,
      data: {
        vendor,
        event_id:         parsed.event_id,
        vendor_intent_id: parsed.vendor_intent_id,
        reason,
        intent_id:        liveIntent?.id ?? null,
        deleted_at:       liveIntent?.deleted_at ?? null,
        got_amount:       parsed.amount_subunit,
        got_currency:     parsed.currency,
        status:           parsed.status,
      },
    })
    // Codex r5 P1：DLQ 是 orphan 唯一憑證 → strict 寫入。寫不進去就 markFailed +
    // throw 讓 PSP retry，不可悄悄 markApplied 把證據丟掉。
    try {
      await dlqInsert(env, {
        vendor,
        event_id: parsed.event_id,
        vendor_intent_id: parsed.vendor_intent_id,
        raw_body: rawBody,
        payload_hash: payloadHash,
        error_stage: reason === 'intent_not_found' ? 'orphan_intent_not_found' : 'orphan_intent_deleted',
        error_message: reason === 'intent_not_found'
          ? 'no matching intent and no user_id to create one'
          : `intent ${liveIntent?.id} soft-deleted at ${liveIntent?.deleted_at}; PSP still sent ${parsed.status}`,
        http_status_returned: 200,
      }, { strict: true })
    } catch (e) {
      await markWebhookEventFailed(env, vendor, parsed.event_id)
      throw e
    }
    try {
      await markWebhookEventApplied(env, vendor, parsed.event_id)
    } catch (e) {
      await markWebhookEventFailed(env, vendor, parsed.event_id)
      await dlqInsert(env, {
        vendor,
        event_id: parsed.event_id,
        vendor_intent_id: parsed.vendor_intent_id,
        raw_body: rawBody,
        payload_hash: payloadHash,
        error_stage: 'mark_applied_orphan',
        error_message: String(e?.message || e).slice(0, 1000),
        http_status_returned: 500,
      })
      throw e
    }
    return successFn()
  }

  // Codex r1 P0-1：orphan intent — webhook 對應的 intent 不存在或已 soft-deleted。
  //   (a) intent && intent.deleted_at  → user/admin 刪 intent 後 PSP 補送（race）
  //   (b) !intent && !parsed.user_id   → ECPay 等不帶 user_id，找不到 row 且無從建
  // 注意：放在 dedupe claim 之後，避免每次 PSP retry 都灌一筆 DLQ。
  if (intent && intent.deleted_at) {
    return handleOrphan({ liveIntent: intent, reason: 'intent_soft_deleted' })
  }
  if (!intent && !parsed.user_id) {
    return handleOrphan({ liveIntent: null, reason: 'intent_not_found' })
  }

  // Codex r6 P1-4 follow-up：illegal_transition / race-CAS-lost 時跳過 metadata
  // merge + payment.status.change audit，避免非法轉移看起來像成功付款；markApplied
  // 仍照常（已 critical audit；阻 PSP retry spam）。
  let skipSuccessTail = false

  // P0-9：原本「沒既存 intent + webhook 帶 user_id」會自動 createPaymentIntent，
  // 但 amount_subunit 直接抄 webhook body → 攻擊者偽造 webhook 即可塞任意金額成功 row。
  // 改成：預設關閉，除非顯式 env flag PSP_DIRECT_INTENT_ENABLED='1' 才允許
  // （我方所有正式 PSP 都先過 /checkout 建 intent，這條 fallback 實際是死路；保留 flag
  //   是讓未來真接「PSP-direct only」vendor 時可顯式開）。
  // 不開時：丟 DLQ + critical audit + 仍回 success（避免 PSP retry 灌爆）。
  const pspDirectAllowed = String(env?.PSP_DIRECT_INTENT_ENABLED ?? '') === '1'

  // Codex r3 P2：psp_direct policy reject 分支不走 createPaymentIntent / updatePaymentStatus，
  // 不該被 outer try 包進去（否則 marker fail 會在 inner catch + outer catch 各 DLQ 一次，
  // 第二筆 stage 還被誤標成 'create_intent'）。整段 hoist 到 outer try 之前。
  if (!intent && parsed.user_id && !pspDirectAllowed) {
    await safeUserAudit(env, {
      event_type: 'payment.webhook.psp_direct_blocked',
      severity:   'critical',
      user_id:    parsed.user_id,
      request,
      data: {
        vendor,
        event_id:         parsed.event_id,
        vendor_intent_id: parsed.vendor_intent_id,
        got_amount:       parsed.amount_subunit,
        got_currency:     parsed.currency,
        status:           parsed.status,
      },
    })
    await dlqInsert(env, {
      vendor,
      event_id: parsed.event_id,
      vendor_intent_id: parsed.vendor_intent_id,
      raw_body: rawBody,
      payload_hash: payloadHash,
      error_stage: 'psp_direct_disabled',
      error_message: 'PSP-direct intent creation disabled (set PSP_DIRECT_INTENT_ENABLED=1 to enable)',
      http_status_returned: 200,
    })
    // P0-2：本 event 已決定不處理（policy 拒絕），標 applied → 之後同 event_id 直接 dedup
    try {
      await markWebhookEventApplied(env, vendor, parsed.event_id)
    } catch (e) {
      // marker 失敗 → 該 row 仍是 processing；PSP retry 會落到同 psp_direct path 重跑（idempotent）
      await markWebhookEventFailed(env, vendor, parsed.event_id)
      await dlqInsert(env, {
        vendor,
        event_id: parsed.event_id,
        vendor_intent_id: parsed.vendor_intent_id,
        raw_body: rawBody,
        payload_hash: payloadHash,
        error_stage: 'mark_applied_psp_direct',
        error_message: String(e?.message || e).slice(0, 1000),
        http_status_returned: 500,
      })
      throw e
    }
    return successFn()
  }

  try {
    if (!intent && parsed.user_id) {
      try {
        const id = await createPaymentIntent(env, {
          user_id:          parsed.user_id,
          vendor,
          vendor_intent_id: parsed.vendor_intent_id,
          kind:             PAYMENT_KIND.DEPOSIT,
          status:           parsed.status,
          amount_subunit:   parsed.amount_subunit,
          amount_raw:       parsed.amount_raw,
          currency:         parsed.currency ?? 'TWD',
          failure_reason:   parsed.failure_reason,
        })
        intent = { id, user_id: parsed.user_id }
      } catch {
        // 同 vendor_intent_id race → 重撈
        intent = await getPaymentIntent(env, { vendor, vendor_intent_id: parsed.vendor_intent_id })
      }
    } else if (intent) {
      const result = await updatePaymentStatus(env, {
        vendor,
        vendor_intent_id: parsed.vendor_intent_id,
        status:           parsed.status,
        failure_reason:   parsed.failure_reason,
      })
      // Codex r6 P1-4 follow-up：structured outcome 區分行為
      if (result.outcome === 'no_row') {
        // r5 P0 TOCTOU：row 被軟刪 race → orphan 補救
        const reread = await getPaymentIntent(env, {
          vendor, vendor_intent_id: parsed.vendor_intent_id, includeDeleted: true,
        })
        if (reread?.deleted_at) {
          return handleOrphan({ liveIntent: reread, reason: 'intent_soft_deleted' })
        }
        // Codex r8 P2：非 soft-delete 的 no_row 表示 CAS 撞到 status 已被別處改
        // （e.g. 兩條 webhook 同時撞 pending→succeeded vs pending→failed，第二條
        //  CAS 落空）。原本只 skipSuccessTail 然後悄悄 markApplied，PSP 不 retry、
        // 沒 DLQ、沒 audit → 事件等於消失。改寫 critical audit 留證；intent 不會
        // 被當前事件改動（這正是預期），但我們知道發生過 race。
        await safeUserAudit(env, {
          event_type: 'payment.webhook.status_cas_lost',
          severity:   'critical',
          user_id:    reread?.user_id ?? intent.user_id ?? null,
          request,
          data: {
            vendor,
            event_id:         parsed.event_id,
            vendor_intent_id: parsed.vendor_intent_id,
            intent_id:        intent.id,
            attempted_status: parsed.status,
            current_status:   reread?.status ?? null,
          },
        })
        skipSuccessTail = true
      } else if (result.outcome === 'illegal_transition') {
        // 內部已寫 payment.status.illegal_transition critical audit；caller 不可
        // merge metadata.trade_no 或寫 payment.status.change（會讓 failed→succeeded
        // 之類非法轉移看起來像成功付款）。markApplied 阻 PSP retry spam。
        skipSuccessTail = true
      }
      // 'applied' / 'same_status' → 繼續走 metadata + audit + markApplied
    }
  } catch (e) {
    // P0-2：dedupe row 標 failed，下次同 event_id retry 才會被當 'processing' 重跑（不會被誤判 dedup hit）
    await markWebhookEventFailed(env, vendor, parsed.event_id)
    await dlqInsert(env, {
      vendor,
      event_id: parsed.event_id,
      vendor_intent_id: parsed.vendor_intent_id,
      raw_body: rawBody,
      payload_hash: payloadHash,
      error_stage: !intent ? 'create_intent' : 'update_status',
      error_message: String(e?.message || e).slice(0, 1000),
      http_status_returned: 500,
    })
    throw e
  }

  // Codex r6 P1-4 follow-up：illegal_transition / no_row CAS-lost 一律跳過此段
  if (!skipSuccessTail) {
  // 若 adapter 回了 payment_info（ATM V 帳號 / CVS 代碼 / 條碼）→ merge 到 metadata.payment_info
  if (parsed.payment_info && intent?.id) {
    await mergeMetadata(env, intent.id, { payment_info: parsed.payment_info })
  }

  // P0-10：付款成功時把 vendor TradeNo 寫進 intent.metadata.trade_no，
  // 退款 endpoint 直接讀取（不再靠 payment_webhook_events 的 event_id 反推）
  if (parsed.status === 'succeeded' && parsed.trade_no && intent?.id) {
    await mergeMetadata(env, intent.id, { trade_no: parsed.trade_no })
  }

  await safeUserAudit(env, {
    event_type: 'payment.status.change',
    severity:   'critical',
    user_id:    intent?.user_id ?? parsed.user_id ?? null,
    request,
    data: {
      vendor,
      event_id:         parsed.event_id,
      vendor_intent_id: parsed.vendor_intent_id,
      status:           parsed.status,
      amount_subunit:   parsed.amount_subunit ?? null,
      amount_raw:       parsed.amount_raw ?? null,
      currency:         parsed.currency ?? null,
      failure_reason:   parsed.failure_reason ?? null,
    },
  })
  } // end !skipSuccessTail

  // P0-2：完工後標 applied。Codex r2 P1：marker 失敗不能 fail-open
  // （否則 intent 已更新但 row 留 processing，未來 retry 不會跑且沒 DLQ）。
  // 標記失敗 → DLQ + 同 row 標 failed + throw 讓 PSP retry；
  // 因 updatePaymentStatus 是 idempotent SET，重跑安全。
  try {
    await markWebhookEventApplied(env, vendor, parsed.event_id)
  } catch (e) {
    await markWebhookEventFailed(env, vendor, parsed.event_id)
    await dlqInsert(env, {
      vendor,
      event_id: parsed.event_id,
      vendor_intent_id: parsed.vendor_intent_id,
      raw_body: rawBody,
      payload_hash: payloadHash,
      error_stage: 'mark_applied',
      error_message: String(e?.message || e).slice(0, 1000),
      http_status_returned: 500,
    })
    throw e
  }

  return successFn()
}

async function markWebhookEventApplied(env, vendor, eventId) {
  if (!env?.chiyigo_db || !eventId) return
  // Codex r2 P1：不可吞錯；caller 負責 DLQ + markFailed + throw
  await env.chiyigo_db
    .prepare(`UPDATE payment_webhook_events SET apply_status = 'applied' WHERE vendor = ? AND event_id = ?`)
    .bind(vendor, eventId).run()
}

async function markWebhookEventFailed(env, vendor, eventId) {
  if (!env?.chiyigo_db || !eventId) return
  try {
    await env.chiyigo_db
      .prepare(`UPDATE payment_webhook_events SET apply_status = 'failed' WHERE vendor = ? AND event_id = ? AND apply_status != 'applied'`)
      .bind(vendor, eventId).run()
  } catch { /* DLQ 已落，標記失敗也不擋 */ }
}

async function mergeMetadata(env, intentId, patch) {
  const row = await env.chiyigo_db
    .prepare(`SELECT metadata FROM payment_intents WHERE id = ?`)
    .bind(intentId).first()
  let current = {}
  if (row?.metadata) {
    try { current = JSON.parse(row.metadata) ?? {} } catch { current = {} }
  }
  const merged = { ...current, ...patch }
  await env.chiyigo_db
    .prepare(`UPDATE payment_intents SET metadata = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(JSON.stringify(merged), intentId).run()
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

// T17 DLQ: 把處理失敗的 webhook 落到 payment_webhook_dlq。
//   Codex r5 P1：strict=true（orphan/憑證路徑）寫失敗 → throw，caller 走
//   markFailed 讓 PSP retry；strict=false（既有 best-effort 路徑）保留吞錯
//   行為（DLQ 自己壞不可擋 PSP response）。
async function dlqInsert(env, row, { strict = false } = {}) {
  if (!env?.chiyigo_db) return false
  let payloadHash = row.payload_hash ?? null
  if (!payloadHash && row.raw_body) {
    try { payloadHash = await sha256Hex(row.raw_body) } catch { /* ignore */ }
  }
  try {
    await env.chiyigo_db
      .prepare(
        `INSERT INTO payment_webhook_dlq
           (vendor, event_id, vendor_intent_id, raw_body, payload_hash,
            error_stage, error_message, http_status_returned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.vendor ?? null,
        row.event_id ?? null,
        row.vendor_intent_id ?? null,
        row.raw_body ?? null,
        payloadHash,
        row.error_stage ?? 'unknown',
        (row.error_message ?? '').slice(0, 1000),
        row.http_status_returned ?? null,
      )
      .run()
    return true
  } catch (e) {
    if (strict) throw e
    return false
  }
}
