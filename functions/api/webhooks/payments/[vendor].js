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
    return res({ error: `Unknown payment vendor: ${vendor}` }, 400)
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
    return res({ error: 'Webhook validation failed' }, 401)
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
      await dlqInsert(env, {
        vendor,
        event_id: parsed.event_id,
        vendor_intent_id: parsed.vendor_intent_id,
        raw_body: rawBody,
        error_stage: 'amount_mismatch',
        error_message: `expected ${intent.amount_subunit} ${intent.currency}, got ${parsed.amount_subunit} ${parsed.currency ?? '?'}`,
        http_status_returned: 401,
      })
      if (typeof adapter.failureResponse === 'function') {
        return adapter.failureResponse('amount_mismatch')
      }
      return res({ error: 'amount_mismatch' }, 401)
    }
  }

  // dedupe — 寫 payment_webhook_events 撞 UNIQUE 即代表重送
  const payloadHash = parsed.raw_body
    ? await sha256Hex(parsed.raw_body).catch(() => null)
    : null
  try {
    await env.chiyigo_db
      .prepare(
        `INSERT INTO payment_webhook_events (vendor, event_id, intent_id, user_id, status_to, payload_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(vendor, parsed.event_id,
            intent?.id ?? null,
            parsed.user_id ?? intent?.user_id ?? null,
            parsed.status, payloadHash)
      .run()
  } catch (e) {
    if (String(e?.message ?? e).includes('UNIQUE')) {
      return successFn({ deduplicated: true })
    }
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

  // 沒既存 intent 且 webhook 帶 user_id → 主動建一筆（PSP 直接通知，跳過我方 /checkout 的場景）
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
      await updatePaymentStatus(env, {
        vendor,
        vendor_intent_id: parsed.vendor_intent_id,
        status:           parsed.status,
        failure_reason:   parsed.failure_reason,
      })
    }
  } catch (e) {
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

  return successFn()
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
