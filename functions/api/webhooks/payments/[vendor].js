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
      data: { vendor, reason: parsed.error },
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
  let intent
  try {
    intent = await getPaymentIntent(env, { vendor, vendor_intent_id: parsed.vendor_intent_id })
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
  if (intent && parsed.amount_subunit != null && intent.amount_subunit != null) {
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

  // dedupe — Codex r1 P0-2：用 apply_status 三態避免「event 已 dedupe 但狀態未套用」漂移。
  // 'applied' 才算真正 dedup hit；'processing'/'failed' 表示上次沒完工，PSP retry 必須重跑。
  // ON CONFLICT 原子更新：已 applied 不動；否則 reset 為 processing。
  const payloadHash = parsed.raw_body
    ? await sha256Hex(parsed.raw_body).catch(() => null)
    : null
  let dedupeRow
  try {
    dedupeRow = await env.chiyigo_db
      .prepare(
        `INSERT INTO payment_webhook_events
           (vendor, event_id, intent_id, user_id, status_to, payload_hash, apply_status)
         VALUES (?, ?, ?, ?, ?, ?, 'processing')
         ON CONFLICT(vendor, event_id) DO UPDATE SET
           apply_status = CASE WHEN payment_webhook_events.apply_status = 'applied'
             THEN 'applied' ELSE 'processing' END,
           processed_at = CASE WHEN payment_webhook_events.apply_status = 'applied'
             THEN payment_webhook_events.processed_at ELSE datetime('now') END
         RETURNING apply_status`,
      )
      .bind(vendor, parsed.event_id,
            intent?.id ?? null,
            parsed.user_id ?? intent?.user_id ?? null,
            parsed.status, payloadHash)
      .first()
  } catch (e) {
    await dlqInsert(env, {
      vendor,
      event_id: parsed.event_id,
      vendor_intent_id: parsed.vendor_intent_id,
      raw_body: rawBody,
      payload_hash: payloadHash,
      error_stage: 'dedupe_insert',
      error_message: String(e?.message || e).slice(0, 1000),
      http_status_returned: 500,
    })
    throw e
  }
  if (dedupeRow?.apply_status === 'applied') {
    return successFn({ deduplicated: true })
  }

  // P0-9：原本「沒既存 intent + webhook 帶 user_id」會自動 createPaymentIntent，
  // 但 amount_subunit 直接抄 webhook body → 攻擊者偽造 webhook 即可塞任意金額成功 row。
  // 改成：預設關閉，除非顯式 env flag PSP_DIRECT_INTENT_ENABLED='1' 才允許
  // （我方所有正式 PSP 都先過 /checkout 建 intent，這條 fallback 實際是死路；保留 flag
  //   是讓未來真接「PSP-direct only」vendor 時可顯式開）。
  // 不開時：丟 DLQ + critical audit + 仍回 success（避免 PSP retry 灌爆）。
  const pspDirectAllowed = String(env?.PSP_DIRECT_INTENT_ENABLED ?? '') === '1'
  try {
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
      await markWebhookEventApplied(env, vendor, parsed.event_id)
      return successFn()
    }
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
      await updatePaymentStatus(env, {
        vendor,
        vendor_intent_id: parsed.vendor_intent_id,
        status:           parsed.status,
        failure_reason:   parsed.failure_reason,
      })
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

  // P0-2：完工後標 applied，之後同 event_id 撞進來才視為真 dedup hit
  await markWebhookEventApplied(env, vendor, parsed.event_id)

  return successFn()
}

async function markWebhookEventApplied(env, vendor, eventId) {
  if (!env?.chiyigo_db || !eventId) return
  try {
    await env.chiyigo_db
      .prepare(`UPDATE payment_webhook_events SET apply_status = 'applied' WHERE vendor = ? AND event_id = ?`)
      .bind(vendor, eventId).run()
  } catch { /* 標記失敗不影響本次回應；PSP 不會 retry 因為已回 success */ }
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

// T17 DLQ: 把處理失敗的 webhook 落到 payment_webhook_dlq；任何 throw 都吞掉
// （DLQ 自己壞掉也不能擋住 PSP 回應）
async function dlqInsert(env, row) {
  if (!env?.chiyigo_db) return
  try {
    let payloadHash = row.payload_hash ?? null
    if (!payloadHash && row.raw_body) {
      try { payloadHash = await sha256Hex(row.raw_body) } catch { /* ignore */ }
    }
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
  } catch { /* swallow — DLQ 失敗不能擋 PSP response */ }
}
