/**
 * Payment vendor adapter 契約（Phase F-2）— 純型別模組（無 runtime export）。
 *
 * 抽出 mock/ecpay adapter + payments.ts registry + webhook handler 三方共用的型別，
 * 解 OD-A（PR-2ct 當時 defer 的 shared interface）。Env / Request / Response 皆
 * ambient global，本檔無 runtime import → 無 circular import 風險、emit 0 bytes。
 */

export interface WebhookParseResult {
  ok: boolean
  error?: string
  code?: string
  event_id?: string
  vendor_intent_id?: string
  user_id?: number | null
  status?: string
  amount_subunit?: number | null
  amount_raw?: string | null
  currency?: string | null
  failure_reason?: string | null
  payment_info?: Record<string, unknown> | null
  trade_no?: string | null
  raw_body?: string
}

export interface PaymentAdapter {
  parseWebhook(request: Request, env: Env): Promise<WebhookParseResult>
  successResponse?(extra?: { deduplicated?: boolean }): Response
  failureResponse?(reason?: string): Response
}
