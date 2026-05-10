# Codex Audit 修復進度（2026-05-10）

第三方 codex 給的 10 項 audit，主 agent 逐項驗證後的修復清單。
**動工前看這份**，做完一條打 ✅，commit hash 寫上。

## 結論一覽

| # | 主張 | 驗證 | 修復狀態 |
|---|------|------|----------|
| 1 | JWT aud 預設不驗（30+ requireAuth 未帶 audience） | ✅ 符合 | ✅ 修 |
| 2 | Refresh 非 atomic（SELECT→batch UPDATE/INSERT） | 🟡 部分（body aud 會被 resolveAud 收斂） | ✅ 修 |
| 3 | SSO token 走 query string `?mbti_token=` | ✅ 符合 | ⬜ 大改延後 |
| 4 | save 先改 status='deal' 再驗 currency/overflow | ✅ 符合 | ✅ 修 |
| 5 | 匿名 requisition 全站共用 5/day + owner_guest_id INSERT 斷鏈 | ✅ 符合 | ✅ 修 |
| 6 | requireRole 只認 4 role，scopes.js 多 super_admin/finance/support | ✅ 符合 | ✅ 修 |
| 7 | requireStepUp revoke JTI 吞 catch（best-effort） | ✅ 符合 | ⬜ 接受現狀 |
| 8 | register 簽 token 缺 ver/scope claim | ✅ 符合 | ✅ 修 |
| 9 | AI assist 前端 sitekey 空 + 後端條件式驗 + ai_audit 存 prompt | ✅ 符合 | ⬜ retention 後補 |
| 10 | BUILD_PLAN mojibake / AUDIT.md 不存在 | ❌ / ✅ | — |

## 本次動工順序

### Round 1（防漏 + 接 bug） — 完成 2026-05-10

- [x] **#5** `functions/api/requisition.js`：INSERT 補 `owner_user_id` + `owner_guest_id`；訪客 limit 改 per-guest_id 5/day（無 guest_id 退回 per-IP 3/day 鎖）；frontend `src/js/requisition.js` 補 `chiyigo.device_uuid` 取得 + `X-Device-Id` header + body.guest_id
- [x] **#4** `functions/api/admin/requisitions/[id]/save.js`：把 MIXED_CURRENCY / OVERFLOW 驗證移到 UPDATE→deal 之前；P2-7 race lock 仍由 atomic UPDATE...RETURNING 提供
- [x] **#8** `functions/api/auth/local/register.js`：access token payload 補 `ver` (token_version) + `scope` (buildTokenScope)；對齊 login.js / refresh.js

### Round 2（權限模型對齊） — 完成 2026-05-10

- [x] **#1** `functions/utils/jwt.js`：signJwt + verifyJwt 預設 audience='chiyigo'（明確 `audience: null` 才關閉）；`functions/api/auth/userinfo.js` 顯式關閉（OIDC 跨 aud）；tests/jwt.test.js 對應更新
- [x] **#6** `functions/utils/requireRole.js`：ROLE_LEVEL 補 super_admin=2 / user=0 / finance=0 / support=0（finance/support 走 requireScope fine-grain，不靠 hierarchy 升權）

### Round 3（並發安全） — 完成 2026-05-10

- [x] **#2** `functions/api/auth/refresh.js`：rotation 改 `UPDATE...WHERE id=? AND revoked_at IS NULL RETURNING`；race 失敗的 caller 視同 reuse_detected → 401

### 後續 Phase（不在本次）

- #3 SSO `?mbti_token=` → fragment / OIDC code+PKCE：跨 repo 大改
- #7 step-up revoke fail-closed：需設計新 audit + 退路
- #9 ai_audit retention / 遮罩政策

## 驗證

- `npm test` → 147 passed（+2 jwt tests for new aud default）
- `npm run test:int` → 452 passed
- `npm run lint` → 0 errors / 18 warnings（同 baseline，無新增）

## Round 4（Codex r2 audit follow-up，2026-05-10）

Codex 二輪驗收主 Round 1-3 後揪出 6 個剩餘缺口，4 high + 2 medium。已全驗證符合並修復。

| # | 主張 | 修復 |
|---|------|------|
| r2-1 | owner_guest_id/owner_user_id 沒 numbered migration → fresh D1 部署 500 | ✅ 補 `migrations/0036_requisition_owner_columns.sql` + index |
| r2-2 | requisition 用 `chiyigo.device_uuid`、register 用 `chiyigo_guest_id` → takeover 永不命中 | ✅ `public/js/auth-ui.js` `getOrCreateGuestId()` 改用 `_chiyigoGetDeviceUuid()`；clearGuestId 變 no-op（避免破壞 refresh token 綁定） |
| r2-3 | takeover 只更新 owner_user_id，不動 user_id → /me、/[id]、revoke 全用 user_id 查不到 | ✅ `register.js` UPDATE 同步寫 user_id；條件加 `user_id IS NULL` 防覆蓋 |
| r2-4 | ban/unban/admin/revoke 自帶 ROLE_LEVEL 表，本次 super_admin 補強沒涵蓋 | ✅ `requireRole.js` 匯出 `actorOutranksTarget`；3 endpoint 改 import |
| r2-5 | refresh aud 仍由 body 決定，子站可用共用 cookie 換 aud=chiyigo token | ⏭ followup（需 Origin/registry 設計） |
| r2-6 | save lock 改 deal 後若 INSERT 失敗，留 status='deal' 但無 deal row | ✅ try/catch 包 INSERT；失敗 UPDATE status='pending' rollback + critical audit + 500 |

## Commit log

- `3a6a11e` — Round 1-3（codex 6 修復）
- `2647914` — Round 4（codex r2 5 修復）
