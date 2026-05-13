-- 0043: payment_intents.deleted_at — Codex r1 P0-1 soft delete + orphan webhook 偵測
--
-- 為什麼要加：
--   原本 user/admin 可 hard DELETE pending 狀態的 intent。PSP（特別是 ECPay）
--   結帳流程進行中時，user 一鍵刪掉 intent，之後 ECPay 仍會送 succeeded webhook。
--   現有 handler 找不到 intent 又沒 parsed.user_id（ECPay 不帶）→ 直接回 1|OK，
--   錢真的被收了但我方 DB 完全沒記錄 → orphan 入帳漏洞。
--
-- 解法：
--   1. user/admin delete pending|failed|canceled 改為 soft delete（寫 deleted_at）
--   2. webhook handler 用 includeDeleted=true 查 intent；若找到但 deleted_at 不為 null
--      → critical audit + DLQ + 不更新 status
--   3. webhook handler !intent && !parsed.user_id 同樣走 orphan 分支
--   4. 既有查詢/列表/狀態更新加 deleted_at IS NULL filter，讓 user/admin 看不到也改不到

ALTER TABLE payment_intents ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_intents_deleted_at
  ON payment_intents(deleted_at);
