-- 0037: refresh_tokens.issued_aud（Codex r9-5 / r2-5 原條 2026-05-10）
--
-- 解 refresh.js audience 由 body 決定的問題：refresh token rotation 時，新 access token
-- 的 aud claim 應綁定發行 token 時的 aud（chiyigo / mbti / talo / sport-app），不該由
-- attacker 控制的 body.aud 任意切換。issued_aud 在 INSERT refresh_tokens 時就鎖定，
-- refresh.js rotation 時直接用 tokenRow.issued_aud 簽，body.aud 不一致則寫 warn audit。
--
-- 舊 row 沒 issued_aud（NULL）→ refresh.js 退回 resolveAud(body.aud) 保 backward compat；
-- token 7d 過期後全部換成有 issued_aud 的新 row，攻擊面收斂完畢。

ALTER TABLE refresh_tokens ADD COLUMN issued_aud TEXT;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_issued_aud ON refresh_tokens(issued_aud);
