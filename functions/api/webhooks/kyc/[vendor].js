/**
 * POST /api/webhooks/kyc/:vendor
 *
 * Phase F-1 — vendor-agnostic KYC webhook 入口。
 *
 * 流程：
 *   1. 用 :vendor path param 找 adapter（resolveKycAdapter）
 *   2. 把 request 丟給 adapter.parseWebhook → 拿驗章後的 normalized payload
 *   3. dedupe：(vendor, event_id) 撞 UNIQUE → 200 already_processed（vendor 重送會擲到這）
 *   4. UPSERT user_kyc + INSERT kyc_webhook_events + audit critical
 *
 * Why critical audit：KYC 狀態改變直接影響金流權限，每筆都要可追溯。
 *
 * 回傳：
 *   200 → { ok: true, deduplicated?: boolean }
 *   400 → vendor 不認識 / payload 錯
 *   401 → 簽章驗證失敗（adapter 報的）
 */

import { res } from '../../../utils/auth.js'
import { resolveKycAdapter, setUserKycStatus } from '../../../utils/kyc.js'
import { safeUserAudit } from '../../../utils/user-audit.js'

export async function onRequestPost({ request, env, params }) {
  const vendor = String(params?.vendor ?? '').toLowerCase()
  const adapter = resolveKycAdapter(vendor)
  if (!adapter) {
    return res({ error: `Unknown KYC vendor: ${vendor}` }, 400)
  }

  const parsed = await adapter.parseWebhook(request, env)
  if (!parsed.ok) {
    // 簽章 / payload 錯都歸 401（不洩漏細節給 attacker；audit 留 reason 給我們追）
    await safeUserAudit(env, {
      event_type: 'kyc.webhook.fail', severity: 'warn', request,
      data: { vendor, reason: parsed.error },
    })
    return res({ error: 'Webhook validation failed' }, 401)
  }

  // dedupe — 寫 kyc_webhook_events 撞 UNIQUE 即代表重送
  const payloadHash = parsed.raw_body
    ? await sha256Hex(parsed.raw_body).catch(() => null)
    : null
  try {
    await env.chiyigo_db
      .prepare(
        `INSERT INTO kyc_webhook_events (vendor, event_id, user_id, status_to, payload_hash)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(vendor, parsed.event_id, parsed.user_id ?? null, parsed.status, payloadHash)
      .run()
  } catch (e) {
    if (String(e?.message ?? e).includes('UNIQUE')) {
      // 重送 → 不重複處理
      return res({ ok: true, deduplicated: true })
    }
    throw e
  }

  // 套用到 user_kyc
  if (parsed.user_id) {
    await setUserKycStatus(env, parsed.user_id, {
      status:           parsed.status,
      level:            parsed.level,
      vendor,
      vendor_review_id: parsed.vendor_review_id,
      rejection_reason: parsed.rejection_reason,
      verified_at:      parsed.verified_at,
      expires_at:       parsed.expires_at,
    })

    await safeUserAudit(env, {
      event_type: 'kyc.status.change',
      severity:   'critical',
      user_id:    parsed.user_id,
      request,
      data: {
        vendor,
        event_id:        parsed.event_id,
        status:          parsed.status,
        level:           parsed.level ?? null,
        rejection_reason: parsed.rejection_reason ?? null,
      },
    })
  }

  return res({ ok: true })
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}
