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

## Round 5（Codex r3 audit follow-up，2026-05-10）

Codex 三輪後 r2 5 條結果：3 修對 + 2 部分。本輪修補 2 部分 + 補建議：

| # | 主張 | 修復 |
|---|------|------|
| r3-1 | r2-1 fresh bootstrap：`_base.sql` 已有 owner_*，跑到 0036 ALTER 會 duplicate column | ✅ 移除 `migrations/_base.sql` 的 owner_guest_id/owner_user_id；補 `tests/integration/_helpers.js` idempotent ALTER（共用 D1 worker 後 _base 路徑也能補回欄位） |
| r3-3 | r2-3 takeover 後 owner_guest_id=NULL 失去訪客→user 軌跡 | ✅ register.js takeover UPDATE 改 RETURNING；命中即寫 `requisition.takeover` audit（含 sha256 截 32 字 guest_id_hash + requisition_ids，不存明文 device id） |
| r3-4 | r2-4 actorOutranksTarget 未知 target role 會被 admin outrank（DB 無 CHECK） | ✅ 改成「未知 actor / target 一律 fail closed」 |
| r3-6 | r2-6 rollback 不是 transaction，只靠 status='deal' guard | ⏭ 接受（D1 無 user transaction；當前 lock=atomic UPDATE...RETURNING，race 窗不存在；未來新增 state 轉移時需重審） |

## 延後（尚未實作）

- **r2-5** refresh aud Origin/registry 綁：需設計
- **r3-測試補強**：codex 建議的 5 條 E2E（migration smoke 0001..0036、guest_id E2E、takeover E2E、role ban 矩陣、save rollback mock）— 高價值但高成本，待人力安排

## Commit log

- `3a6a11e` — Round 1-3（codex 6 修復）
- `2647914` — Round 4（codex r2 5 修復）
- `8f0648c` — Round 5（codex r3 3 修復）

## Round 6（Codex r4 audit follow-up，2026-05-10）

| # | 主張 | 修復 |
|---|------|------|
| r4-3 | r3-3 takeover audit `user_id: null` 不理想 | ✅ RETURNING 也帶 user_id；audit 直接寫 newUserId |
| r4-4 | r3-4 unknown role 拒絕應寫 critical audit 通知 oncall | ✅ requireRole.js 匯出 `KNOWN_ROLES` / `isKnownRole`；ban/unban/admin/revoke 在 unknown target role 時寫 `admin.unknown_role_target` critical audit |
| r4-bonus | register 端對 guest_id 沒驗 web-uuid 格式（防禦深度） | ✅ register.js 加 `/^web-[0-9a-f-]{36}$/i` 預驗；test fixtures 對齊 |
| r4-1 | migration smoke 仍只到 0012，沒真正驗 _base + 0001..0036 | ⏭ 標 followup（測試擴充） |
| r4-misc | functions/utils/role-change.js:66 latent UPDATE users SET role | ⏭ 目前無 API caller，未來開 endpoint 必須補 actorOutranksTarget |
