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
  PAYMENT_KIND, PAYMENT_STATUS,
} from '../../../utils/payments.js'
import { safeUserAudit } from '../../../utils/user-audit.js'

export async function onRequestPost({ request, env, params }) {
  const vendor = String(params?.vendor ?? '').toLowerCase()
  const adapter = resolvePaymentAdapter(vendor)
  if (!adapter) {
    return res({ error: `Unknown payment vendor: ${vendor}` }, 400)
  }

  const parsed = await adapter.parseWebhook(request, env)
  if (!parsed.ok) {
    await safeUserAudit(env, {
      event_type: 'payment.webhook.fail', severity: 'warn', request,
      data: { vendor, reason: parsed.error },
    })
    return res({ error: 'Webhook validation failed' }, 401)
  }

  // 找對應的 intent
  let intent = await getPaymentIntent(env, { vendor, vendor_intent_id: parsed.vendor_intent_id })

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
      return res({ ok: true, deduplicated: true })
    }
    throw e
  }

  // 沒既存 intent 且 webhook 帶 user_id → 主動建一筆（PSP 直接通知，跳過我方 /checkout 的場景）
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

  return res({ ok: true })
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}
