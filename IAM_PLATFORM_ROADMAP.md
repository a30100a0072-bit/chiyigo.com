# IAM 平台化升級路線圖（金融級）

**建立日期**：2026-05-02
**最後更新**：2026-05-02
**目標規模**：chiyigo.com IdP → **金融級多 App 平台 IdP**
**已知未來 client**：
- chiyigo / mbti / talo（既有 web）
- 健身 App（mobile native）
- 撲克遊戲平台（大老二、德州、麻將）
- 桌遊平台
- **金流串接（Stripe / TapPay 等）**
- **虛擬貨幣相關業務**

**現況評級**：合規 90%，可上線；對「金融 + mobile + 即時遊戲」場景需大幅強化

---

## 0. 戰略前提（必讀）

### 0.1 法遵紅線

| 領域 | 必守規則 |
|---|---|
| 真錢遊戲 | **台灣賭博違法**。要嘛走「虛擬幣不可換現」（社交遊戲模式），要嘛海外設公司 + 執照。這個決策**先於**架構設計 |
| 信用卡金流 | **絕不接觸卡號**。一律走 Stripe / TapPay / 綠界 等 PSP，PCI-DSS 範圍降到 SAQ-A |
| 虛擬貨幣 | **不做 custodial wallet**（自託管 = 你變銀行，責任無限）。走 WalletConnect / web3 模式，user 連自己的錢包，IdP 只驗 wallet 簽章 |
| KYC/AML | 金流上線前必須建立。第三方服務（Sumsub / Persona / 永豐 KYC）+ 自家 verification status 表 |
| GDPR / 個資法 | 「右遺忘」vs「audit log 不可變」的衝突 → 用 user_id 假名化 + 個資 envelope encryption + 刪除時刪 key |

### 0.2 架構原則（不可動搖）

1. **IdP 獨立子系統**：身分認證搬到 `auth.chiyigo.com`，與業務 App 物理隔離。一個遊戲 bug 不能影響支付不能影響身分
2. **Blast radius 控制**：每個 App 一個 client_id + 獨立 scope；任一 App 被攻破，其他 App 不受影響
3. **金融操作必走 step-up**：提款 / 轉帳 / 改密碼 / 改 email / 大額下注前，必須重新 2FA（即使已登入）
4. **零信任**：access_token 不代表授權做某動作；高風險操作另查 introspection + 風控
5. **不可變 audit log**：所有金融相關事件 append-only，不可改不可刪（法遵要求）
6. **資料分級**：PII / 金鑰 / wallet address envelope encryption；token / session 一般加密；公開資料明文

### 0.3 為什麼要先設計好

下列東西「事後改」會痛：
- DB schema 一旦有資料就難改欄位
- JWT claim 結構一旦 mobile App 出 v1.0 就鎖死
- scope 命名散到各 App 後改名 = 所有 client 一起改
- client_id 命名規則 + endpoint 路徑同上
- audit log 格式 = 法遵留證物，後改 = 過去的證物失效

「不該先做」的：沒人用的 UI、為假設需求加抽象層、整套未上線就先做完整 admin。

→ **Phase 0 只設計「不可逆」的部分**，code 仍照階段推進。

---

## 1. 升級藍圖（6 個 Phase）

```
Phase 0：Foundation Design — schema/scope/claim/client_id 全部設計鎖定   ← 1.5 週
Phase A：基線補完（aud / cookie path / CSP）                              ← 順便做
Phase B：jti + token revocation + 不可變 audit log                        ← 1.5 週
Phase C：oauth_clients 表 + fine-grained scope + step-up auth flow        ← 2 週
Phase D：device binding + WebAuthn/Passkeys + 裝置管理 UI                 ← 2 週
Phase E：mandatory 2FA + risk-based auth + rate limiting                  ← 1.5 週
Phase F：金流 / 虛擬貨幣對接（KYC/AML hook + 簽章驗證）                  ← 對接時
```

> **獨立軸：Silent SSO**（不在 Phase A–F 編號內，避免與 Phase B 撞名）
> - ✅ **Phase 1**（2026-05-04 完工 + 實機 PASS）：cookie session check + auto auth_code + `prompt=none`/`prompt=login`
> - ✅ **Phase 2a**（2026-05-04 完工，整合測試 18/18 PASS）：`max_age` 參數 + auth_time 全鏈路追蹤（migration 0019）
> - **Phase 2b**：consent UI + `id_token_hint` re-auth
> - **Phase 3**：multi-account picker
> 詳見 memory `project_silent_sso.md`。

---

## 2. Phase 0 — Foundation Design（不可逆設計鎖定）

**目標**：把所有「事後改痛」的東西**一次設計完寫進 docs 與 migrations**，但不全部接 code。

### 0-1. 寫完所有 migrations（表先建好，code 後接）

```
migrations/
  00XX_oauth_clients.sql           — client 註冊表
  00XX_revoked_jti.sql             — token 黑名單
  00XX_user_devices.sql            — 裝置管理
  00XX_audit_log.sql               — 不可變 audit log（append-only）
  00XX_user_2fa.sql                — TOTP / WebAuthn credentials
  00XX_step_up_sessions.sql        — 高權限暫時性 session
  00XX_user_kyc.sql                — KYC 驗證狀態
  00XX_user_wallets.sql            — 鏈上錢包綁定（不存 private key）
  00XX_pii_encrypted.sql           — 加密 PII（envelope encryption）
  00XX_rate_limit_buckets.sql      — rate limit 計數
```

每個表只建空表 + index，code 仍走舊路。

### 0-2. 文檔產出（鎖定規範）

- `docs/JWT_SPEC.md` — access_token / id_token / step_up_token 完整 claim 規格
- `docs/SCOPES.md` — 全平台 scope 命名表（read:fitness / play:poker / write:wallet / payment:execute ...）
- `docs/CLIENT_IDS.md` — client_id 命名規則 + 預先註冊所有預期 client
- `docs/AUDIT_EVENTS.md` — audit log 事件類型清單（login / token_issue / 2fa_pass / payment_init / wallet_connect / cheat_detected ...）
- `docs/STEP_UP_FLOW.md` — 高權限操作 step-up 流程圖
- `docs/THREAT_MODEL.md` — STRIDE 威脅模型（針對金融 + 遊戲場景）
- `docs/DATA_CLASSIFICATION.md` — 資料分級 + 加密策略
- `docs/COMPLIANCE.md` — GDPR / 個資法 / KYC/AML 對應清單

### 0-3. 既有 3 站點雙寫過渡

- code 走舊 `ALLOWED_REDIRECT_URIS`，**同時** 讀新 `oauth_clients` 比對（log only）
- 跑 1 個月，確認新表設計沒漏，再切換

### 0-4. JWT Claim 完整規格（鎖定）

```jsonc
// access_token (15min TTL)
{
  "iss": "https://auth.chiyigo.com",   // 未來搬到子網域
  "sub": "uid_abc123",                  // 假名化 ID（非數字）
  "aud": "fitness-ios",                 // client_id
  "exp": 1234567890,
  "iat": 1234567890,
  "jti": "uuid-v4",                     // 唯一 ID（可 revoke）
  "scope": "read:profile write:fitness",
  "ver": 0,                             // token_version（全域 revoke）
  "did": "device-uuid",                 // device binding
  "kyc": "verified",                    // none | pending | verified | rejected
  "tier": "basic",                      // basic | premium | vip
  "amr": ["pwd", "totp"],               // 認證方式（OIDC 標準）
  "acr": "urn:chiyigo:loa:2"            // Level of Assurance
}

// step_up_token (5min TTL，金融操作專用)
{
  ...同上,
  "scope": "elevated:payment",
  "for_action": "withdraw",             // 限定用途
  "amr": ["pwd", "totp", "webauthn"]    // 比 access_token 嚴
}
```

### 0-5. Scope 命名規範（鎖定）

```
# 讀寫資源
read:profile / write:profile
read:fitness / write:fitness
read:games / write:games
read:wallet / write:wallet

# 遊戲動作
play:poker / play:mahjong / play:boardgame

# 高權限（必走 step-up）
elevated:payment       # 任何金流操作
elevated:withdraw      # 提款
elevated:wallet_op     # 轉幣 / 連錢包
elevated:account       # 改密碼 / 改 email / 刪帳號

# 站點專屬
read:mbti / read:talo

# Admin
admin:users / admin:revoke / admin:audit
```

### 0-6. Audit Log Schema（不可變）

```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,        -- 'login' / 'token_issue' / 'payment_init' / ...
  user_id_hash TEXT,               -- 假名化（HMAC(user_id, secret)）
  client_id TEXT,
  ip_hash TEXT,                    -- HMAC(ip, secret) — 平衡隱私 + 可追蹤
  ua_hash TEXT,
  event_data TEXT,                 -- JSON，敏感欄位 envelope encrypted
  prev_hash TEXT,                  -- 前一筆 hash（chain of custody）
  this_hash TEXT NOT NULL,         -- 本筆 hash
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 只能 INSERT，不可 UPDATE / DELETE（trigger 阻擋）
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
```

GDPR「右遺忘」 vs audit 不可變的衝突：
→ user_id 用 HMAC 假名化，刪帳號時 HMAC key 一起刪 → audit log 還在但無法反查 user

### 0-7. 加密策略（envelope encryption）

- **Master key**：Cloudflare Secret（不入 D1，不入 git）
- **DEK（Data Encryption Key）**：每筆敏感資料一把，用 master key 加密後存 D1
- **加密欄位**：email（hash for query + encrypted for display）/ wallet address / KYC 證件號碼 / 真名 / 電話
- **演算法**：AES-256-GCM via WebCrypto

**Phase 0 完成定義**：
- [ ] 所有 migrations 跑過，dev / prod D1 表都建好（空表）
- [ ] 8 份 docs 都寫完，team review pass
- [ ] 既有 3 站點雙寫 `oauth_clients` 比對 log，1 個月零差異

---

## 3. Phase A — 基線補完（順便做）

合進 Phase 0 期間做完，不另開 sprint。

- [x] `verifyJwt` 加 audience 驗證能力（opt-in `opts.audience`，2026-05-05）；`requireAuth` 同步加 `opts.audience` 透傳；resource server 端點可逐一 opt in
- [x] Refresh cookie 路徑收緊：實際 Path=`/api/auth`（覆蓋 refresh / end-session / authorize silent SSO 三條都讀 cookie；窄到 `/api/auth/refresh` 會打死 silent SSO + cookie fallback logout，roadmap 條目原意已滿足）
- [x] CSP 加 `object-src 'none'`（2026-05-05）
- [x] grep 確認 access_token 不在 localStorage（2026-05-05 全站 0 命中）
- [x] CSP 移除 `'unsafe-inline'`（CSP Phase A→D 2026-04-30 已完成）

---

## 4. Phase B — jti + Token Revocation + Audit Log 上線

### B1. JWT 加 jti
- access_token + refresh_token + id_token 都加 `jti`
- payload 結構照 Phase 0 規格

### B2. revoked_jti 黑名單接 code
- `verifyJwt` 驗簽通過後查黑名單
- KV 快取（key=jti, TTL=15min）降低 D1 QPS

### B3. Admin Revoke API
- `POST /api/admin/revoke` — 限 admin role
- payload 三種模式：`{jti}` / `{user_id}` / `{user_id, device_uuid}`

### B4. Audit log 接所有金融相關 event
- 從 Phase 0 docs 的事件清單接起來
- 每筆寫入計算 prev_hash → this_hash 形成 chain
- 異常斷鏈 → Discord 告警

### B5. Audit log query API
- `GET /api/admin/audit?user_id=xxx&from=...&to=...`
- 限 admin + step-up token

**完成定義**：
- 單一 token 可精準 revoke
- 所有金融 event 不可變記錄
- audit chain 可驗整性（hash 比對）

---

## 5. Phase C — oauth_clients + Fine-grained Scope + Step-up

### C1. oauth_clients 切流
- 移除 `ALLOWED_REDIRECT_URIS` 常數
- authorize / token / end-session 全走表

### C2. Scope 驗證接 resource server
- 健身 / 遊戲 / wallet API 各自宣告 required scope
- helper：`requireScope('write:fitness')`

### C3. **Step-up Authentication Flow**（重要）
- `POST /api/auth/step-up`
  - 帶現有 access_token + 重新 2FA challenge
  - 通過 → 簽 `step_up_token`（5min TTL，scope=`elevated:xxx`）
- 金融 endpoint 必驗 step_up_token 而非 access_token
- step_up_token 用過即丟（jti 黑名單）

### C4. Discovery 補 step-up 規格
- `acr_values_supported`
- `claims_parameter_supported`

**完成定義**：新 client 上線只需 INSERT 一列；提款 / 改密碼必走 step-up

---

## 6. Phase D — Device Binding + WebAuthn / Passkeys

### D1. Refresh token 強綁 device_uuid
- refresh.js 比對 X-Device-Id header
- 不符 → 撤銷 + 告警 + audit log

### D2. **WebAuthn / Passkeys 註冊與驗證**（金融必備）
- `POST /api/auth/webauthn/register-options`
- `POST /api/auth/webauthn/register-verify`
- `POST /api/auth/webauthn/login-options`
- `POST /api/auth/webauthn/login-verify`
- 新表 `user_webauthn_credentials`（已在 Phase 0 建）
- 用 `@simplewebauthn/server`（Cloudflare Workers 相容）

### D3. Dashboard 裝置管理頁
- 列裝置 + 最後 IP/時間 + WebAuthn 綁定狀態
- 「登出此裝置」「移除 passkey」按鈕

### D4. 異常裝置警示
- 新裝置首次登入 → email 通知
- 跨國 IP 跳變 → audit log + 告警

**完成定義**：mobile App 可走 device binding；高安全用戶可改用 passkey 取代密碼

---

## 7. Phase E — Mandatory 2FA + Risk-based Auth + Rate Limiting

### E1. Mandatory 2FA（金融用戶）
- KYC 通過 / 開通金流 → 強制開 2FA（TOTP 或 passkey）
- 未開不能進 elevated:* scope

### E2. Risk-based Authentication
- 評分機制：IP 異常 / UA 異常 / 時段異常 / 失敗次數
- 高分 → 強制 step-up；極高分 → 鎖帳號 + email 通知

### E3. Rate Limiting at IdP
- `/api/auth/login`：5 / IP / min
- `/api/auth/refresh`：30 / token / min
- `/api/auth/oauth/token`：10 / IP / min
- `/api/auth/step-up`：3 / user / min
- 用 D1 `rate_limit_buckets` 表 + KV 快取
- 觸發 → 429 + audit log

### E4. Brute force protection 強化
- 同 user 連續失敗 → 漸進式 delay（exp backoff）
- 同 IP 跨 user 嘗試 → IP 黑名單（24hr）

**完成定義**：金融用戶帳號被 takeover 的成本 >> 帳號內價值

---

## 8. Phase F — 金流 / 虛擬貨幣對接

對接時才做，這裡只列前置。

### F1. KYC/AML Hook
- 整合 Sumsub / Persona / 永豐 KYC
- `user_kyc.status` 欄位驅動 `kyc` claim
- `kyc!=verified` 不能進 `elevated:withdraw`

### F2. 金流 Webhook 驗章
- Stripe webhook 簽章驗證（HMAC）
- 一律 idempotent（webhook 可能重送）
- 全部寫 audit log

### F3. 錢包連接（非託管）
- 用 SIWE（Sign-In with Ethereum）/ WalletConnect
- 驗 wallet 簽章 → 綁定到 user_wallets
- IdP 不存 private key
- 鏈上交易由 client 自行發起

### F4. 反詐欺整合
- 第三方：MaxMind / Sift / 自建規則
- 評分結果 → audit log + risk score → 影響 step-up 強度

---

## 9. 不做（明確排除）

| 項目 | 為何不做 |
|---|---|
| Custodial 加密貨幣錢包 | 你變銀行，責任無限。一律 non-custodial |
| 自建信用卡收單 | PCI-DSS Level 1 成本爆表，一律走 PSP |
| 自建反詐欺系統 | 用第三方 + 自家規則補強就夠 |
| Dynamic Client Registration | 第三方開發者開放是 marketplace 階段，先 N/A |
| mTLS Client Auth | 金融 B2B 才需要 |
| FAPI 2.0 全套 | 銀行級，過度設計 |
| 自建 KYC（OCR / 人臉）| 用 Sumsub / Persona |

---

## 10. 排程建議

```
Week 1-2:    Phase 0 — Foundation Design（含 Phase A 基線）
Week 3-4:    Phase B — jti + audit log
Week 5-6:    Phase C — oauth_clients + scope + step-up
Week 7-8:    Phase D — device binding + WebAuthn
Week 9-10:   Phase E — mandatory 2FA + rate limit
            （此時：可開始接金流 PSP 與健身 App）
Week 11+:    Phase F — 對接時做
```

---

## 11. Regression 守門（每 Phase 必跑）

- [ ] chiyigo / mbti / talo 三站 SSO 全綠
- [ ] front-channel logout 三站（chiyigo/mbti/talo same-site）同步
- [ ] **back-channel logout（OIDC 1.0）對 sport-app（cross-site）同步** — 2026-05-04 加入，補 storage partitioning 切斷 frontchannel 的洞
- [ ] refresh rotation 正常
- [ ] OIDC Discovery + JWKS 200
- [ ] vitest 全綠
- [ ] **新增**：audit chain hash 連續性驗證
- [ ] **新增**：rate limit 邊界測試（恰好觸發 / 恰好不觸發）

---

## 12. 風險表

| 風險 | 等級 | 緩解 |
|---|---|---|
| 真錢遊戲法遵紅線觸碰 | 🔴 致命 | 上線前法律意見書；不可換現走「虛擬幣社交遊戲」模式 |
| Custodial wallet 誤踩 | 🔴 致命 | 架構設計階段就排除；wallet 一律 non-custodial |
| KYC 資料外洩 | 🔴 致命 | envelope encryption + 限縮 admin 存取 + audit log |
| Audit log 不可變被破 | 🟠 高 | trigger 阻擋 + chain hash + 異常告警 |
| Step-up token 重放 | 🟠 高 | 5min TTL + 用後即丟（jti 黑名單） |
| oauth_clients 表設計改錯 | 🟠 高 | 雙寫過渡 1 個月 |
| D1 寫入瓶頸（audit log + rate limit）| 🟡 中 | KV / Durable Objects 分流；audit log 可考慮 R2 archive |
| 單一 IdP 故障 = 全平台癱瘓 | 🟠 高 | 子網域 auth.chiyigo.com 獨立部署；Cloudflare 多 region |
| Solo dev 維護負擔 | 🟡 中 | 自動化測試覆蓋率 80%+ / Discord 告警 / 月度 audit review |

---

## 13. 維護紀錄

| 日期 | 事件 |
|---|---|
| 2026-05-02 | 初版（5 Phase，限 OIDC 多 App） |
| 2026-05-04 | 加入 OIDC Back-Channel Logout 1.0 為跨 site RP（sport-app on pages.dev）SSO 登出機制；併行 frontchannel 不取代，作雙保險 |
| 2026-05-04 | 加入 oauth_clients 通用 RP 註冊機制需求；Phase 1 in-code registry 集中現有 5 處 hardcode；Phase 2 D1 表化排在本路線圖 Phase C；目標：新增 RP 從改 5 個檔變成跑 1 條 SQL |
| 2026-05-05 | Phase A 全部結案：verifyJwt/requireAuth 加 opt-in audience；CSP 加 `object-src 'none'`；refresh cookie path 維持 `/api/auth`（窄到 `/api/auth/refresh` 會打死 silent SSO + end-session cookie fallback） |
| 2026-05-05 | Phase B 全部結案 + 實機驗收 PASS：B1 jti / B2 revocation check / B3 Admin Revoke API / B4 audit_log 22 事件接 ~15 endpoint / B5 GET /api/admin/audit；AUDIT_IP_SALT + DISCORD_AUDIT_WEBHOOK 已設；critical 告警鏈路（mfa.disable / account.delete → Discord）通；附錄 bug：2FA disable 後 dashboard UX 異常（純前端，排 Phase D 修） |
| 2026-05-05 | 2FA disable UX bug 修復：dashboard 主動清 token + 跳 login.html?tfa_disabled=1 |
| 2026-05-05 | Phase C-1 Wave 1（oauth_clients D1 化）：migration 0020 補欄位 + seed 4 RP；oauth-clients.js 加 async getAllClients/getClient/getValidAuds（KV cache + D1 + in-code fallback）；既有 sync exports 保留向後相容；待 Wave 2 切 consumers / Wave 3 admin CRUD |
| 2026-05-05 | Phase C-1 Wave 2（consumers 切 sync getter）：cors / authorize / end-session / backchannel 全切到 sync getter（讀 module-level cache）；`_middleware.js` 觸發 `refreshClientsCache(env)`（per-isolate 60s throttle）；走 sync 而非 async cascade，避免改 ~14 處 handler；待 Wave 3 admin CRUD 即可零 deploy 加 RP |
| 2026-05-05 | Phase C-1 Wave 3（admin CRUD）：POST/GET/PATCH/DELETE /api/admin/oauth-clients[/:id]；寫入後 invalidateClientsCache + admin_audit_log（hash chain）；refreshClientsCache 微調為 D1 空表 fallback 回 in-code（避免測試跨檔污染）；249 整合測試全綠；**Phase C-1 全部結案**：新 RP 從改 5 檔變成跑一條 admin POST，不必 deploy code |
| 2026-05-05 | Phase C-2 fine-grained scope：scopes.js catalog + ROLE_BASE_SCOPES；buildTokenScope（role 內建 + OIDC merge）；requireScope helper；6 個 token 簽發點加 scope claim；admin/audit 套 PoC；effectiveScopesFromJwt 對舊 token 從 role fallback 確保部署不踢人；108 unit + 249 integration 全綠 |
| 2026-05-05 | Phase C-3 step-up auth flow：POST /api/auth/step-up（需 access_token + TOTP）→ 簽 5min 短效 step_up_token（含 elevated:* + for_action + amr/acr）；requireStepUp helper（嚴格 scope，不走 role fallback；一次性消耗 jti）；ELEVATED_ACCOUNT/PAYMENT/WITHDRAW/WALLET_OP 4 個 elevated scope；hasExactScopeInToken 防 admin 自動取得；舊高權限 endpoint 暫不改造排到 Phase D/E；264 integration 全綠 |
| 2026-05-05 | Phase C-4 Discovery 補欄位（**Phase C 全部結案**）：openid-configuration 公告 acr_values_supported=['urn:chiyigo:loa:2']、claims_parameter_supported=false、claims_supported 加 acr/amr/for_action/scope；自訂 metadata urn:chiyigo:step_up_endpoint + step_up_scopes_supported；268 integration 全綠 |
| 2026-05-05 | C-3 第一個 production consumer：POST /api/auth/account/change-password（in-session 改密碼）；用 requireStepUp(elevated:account, 'change_password') 守門 + bumpTokenVersion 全撤；填補 chiyigo 原本只能用 forgot-password email link 改密碼的 UX gap；既有 reset-password / delete confirm 因 email link 已強，不另改造；278 integration 全綠 |
| 2026-05-05 | Tooling：wrangler 3.99 → **4.87** 升級（package.json devDeps 釘）。Pages secret list / D1 execute 皆通；vitest-pool-workers@0.5.40 與 wrangler 4 共存無問題；CI wrangler-action@v3 自動採用 package.json 版本不需改 yml。108 unit + 278 integration 全綠 |
| 2026-05-05 | Phase F-2 wave 2 ECPay adapter（後端完工）：functions/utils/payment-vendors/ecpay.js — `ecpayCheckMacValue`（.NET URL encode + lowercase + SHA256 大寫 hex；CheckMacValue 自身被忽略避免遞迴；~ → %7e、%20 → +）+ `ecpayPaymentAdapter.parseWebhook`（form-urlencoded 解析、簽章驗證、RtnCode 1→succeeded / 10100073→processing(ATM/CVS 取號) / 其餘→failed；event_id=TradeNo 做 dedup；vendor_intent_id=MerchantTradeNo）+ `successResponse`/`failureResponse`（plain text "1\|OK" / "0\|reason"）+ `buildEcpayCheckoutFields`（產 form 給前端）+ `generateMerchantTradeNo`（cy+ts+rand 20 char）；POST /api/auth/payments/checkout/ecpay — 需 KYC verified + amount 1–200000 TWD + ChoosePayment 預設 ALL（信用卡/ATM/超商/條碼/Apple/Google Pay 全包）+ INSERT payment_intents pending + 回 `{checkout_url, fields, intent_id}`；webhook handler [vendor].js 改：success/dedup 走 adapter.successResponse 若有定義（mock 保持 JSON）+ failureResponse fallback；故意設計：PAYMENT_STATUS 在 ecpay.js freeze 一份避免 payments.js↔ecpay.js circular import；env 沒設 ECPAY_* 時 fallback 沙箱公開 creds（MerchantID 2000132），prod 忘設 secret 走測試環境不會誤扣真錢；新增 payments-ecpay.test.js（13 條：CheckMacValue 演算法 + parseWebhook 4 case + successResponse + checkout 3 case + 端到端 + dedup + 簽章錯）；108 unit + 427 integration 全綠（414 + 13 新）。**前端 UI 未做 + 待辦清單見 memory `project_iam_phase_f2_todo.md`**（前端 UI / requisition 串接 / ATM PaymentInfoURL / withdraw / 退款 / Stripe / TapPay / 訂閱抽象） |
| 2026-05-05 | Phase F-2 金流 webhook scaffold（vendor-agnostic 鋪好等接）：migration 0025 建 payment_intents（user_id / vendor / vendor_intent_id / kind enum=deposit\|withdraw\|subscription\|refund / status enum=pending\|processing\|succeeded\|failed\|canceled\|refunded / amount_subunit INTEGER 法幣最小單位 / amount_raw TEXT 鏈上 decimal string / currency / metadata JSON / failure_reason / UNIQUE(vendor, vendor_intent_id))+ payment_webhook_events（vendor+event_id UNIQUE 做 idempotency 鏡射 KYC pattern）；utils/payments.js 新增 PAYMENT_STATUS / PAYMENT_KIND enum + createPaymentIntent / getPaymentIntent / updatePaymentStatus + requirePaymentAccess gate（access_token + KYC verified；opts.skipKyc 給一般查詢；opts.requiredLevel='enhanced' 給高額提款）；adapter pattern：utils/payment-vendors/mock.js（HMAC-SHA256 給 tests + smoke test）；resolvePaymentAdapter dispatch（stripe / tappay / ecpay stub 等選定接）；新增 GET /api/auth/payments/intents（list + ?status= ?kind= ?limit= 過濾，skipKyc 一般查詢）+ GET /api/auth/payments/intents/:id（雙欄過濾防越權 → 404）+ POST /api/webhooks/payments/[vendor]（驗章 → dedupe → UPSERT intent + critical audit `payment.status.change`；webhook 帶 user_id 但沒既存 intent 時主動建 row 應對 PSP 直接通知場景）；故意不做：payment_ledger 雙記帳（充值 vs 訂閱 vs 一次性付款場景對帳模型不同等真接 PSP 才知道）+ JWT kyc claim（延續 F-1 決策走 D1 lookup）+ /checkout / /withdraw 端點（vendor SDK 啟動 session 等選定）+ 退款 / chargeback 流程；env vars 新增 `PAYMENT_MOCK_SECRET`（**production 一定要設不然任何人可偽造**）；cleanup cron 加 payment_webhook_events 90 天 GC；新增 payments.test.js（20 條：helper CRUD + UNIQUE / amount 雙欄位 / requirePaymentAccess gate verified vs 未 verified vs skipKyc / list filter + 越權隔離 / detail 自己 vs 別人 → 404 / webhook 簽章錯 / 既存 intent UPDATE / 沒既存 intent 主動建 / 重送 dedup / failed payload）；prod migration 已 apply（28 tables）；108 unit + 414 integration 全綠（之前 394 + 20 新）|
| 2026-05-05 | Phase F-1 KYC scaffold（vendor-agnostic 鋪好等接）：migration 0024 建 user_kyc（user_id UNIQUE / status enum / level / vendor / vendor_session_id / vendor_review_id / rejection_reason / verified_at / expires_at）+ kyc_webhook_events（vendor+event_id UNIQUE 做 idempotency）；utils/kyc.js 新增 KYC_STATUS / KYC_LEVEL enum + getUserKycStatus（過期 row 自動降為 expired）+ setUserKycStatus（SQLite UPSERT）+ requireKyc(opts)（gate helper，audit `kyc.gate.fail` warn）；adapter pattern：utils/kyc-vendors/mock.js（HMAC-SHA256 簽章，給 tests + prod smoke test 用）；resolveKycAdapter dispatch 給 vendor-specific parser（sumsub / persona / shinkong stub 等選定接）；新增 GET /api/auth/kyc/status（回 status + can_withdraw）+ POST /api/webhooks/kyc/[vendor]（簽章驗章 → dedupe via UNIQUE → UPSERT user_kyc + critical audit `kyc.status.change`）；故意不做：JWT 加 kyc claim（牽連 5+ 簽 token 點，且 status 改變要立即生效不能等 15min）+ /kyc/start（vendor-specific SDK 啟動 session 等選定）；env vars 新增 `KYC_MOCK_SECRET`（**production 一定要設不然任何人可偽造**）；cleanup cron 加 kyc_webhook_events 90 天 GC；新增 kyc.test.js（15 條：helper UPSERT/expired、requireKyc gate verified/未 verified/level 不夠、status endpoint、webhook 簽章/dedupe/rejected）；prod migration 已 apply；108 unit + 394 integration 全綠 |
| 2026-05-05 | Phase F-3 前端 UI（**Phase F-3 全結案，後端 + 前端**）：dashboard 加 wallets-section + sidebar/mobile-overlay nav `nav_wallets`；dashboard.js 新增 loadWallets / renderWallets / addWallet（連 EIP-1193 provider window.ethereum + personal_sign + verify）/ openWalletRemove / cancelWalletRemove / confirmWalletRemove（step-up `elevated:account` + for_action='unbind_wallet'）；buildSiweMessageClient 在 client side 拼 EIP-4361 message 給 wallet 簽（domain/uri/chain_id/nonce/expires 從 server /nonce 端點取，避免 client 偽造）；isSecureContext + window.ethereum 偵測 → 不支援時禁用按鈕 + 顯示「請安裝 MetaMask / Rabby / Coinbase Wallet」；i18n 4 語各 ~24 個新 key；click delegation 加 4 個 handler；emerald 系 button styling；applyLangD re-render hook 加 `_lastWallets`；syntax OK，108 unit + 379 integration 全綠（前端不影響後端）。**待瀏覽器驗證 H 段 + I 段**（連 MetaMask 真實簽章流程）|
| 2026-05-05 | Phase F-3 SIWE 錢包綁定：migration 0023 建 user_wallets（id/user_id/address lowercase/chain_id/nickname/signed_at/last_used_at + UNIQUE(user_id, address)) + wallet_nonces（5min TTL + 一次性 consumed_at + cleanup cron 加進 list）；自實作 `functions/utils/siwe.js`（不引 siwe@2 因 ethers v6 拉 node:https Workers test runtime 跑不了；改用 @noble/curves + @noble/hashes 自實作 EIP-4361 parser + EIP-191 hash + ecrecover + domain/uri/time bounds 嚴格驗）；新增 4 endpoints：POST /api/auth/wallet/nonce（issue + 寫表）/ POST /api/auth/wallet/verify（驗章 + nonce 一次性消耗 + INSERT，nonce.user_id 不符走 critical audit）/ GET /api/auth/wallet（列當前 user）/ DELETE /api/auth/wallet/:id（**需 step-up `elevated:account` for_action='unbind_wallet'**）；綁/解綁都寫 critical audit（金流前置等同 mfa.disable 等級）；env vars 新增 `WALLET_SIWE_DOMAIN` / `WALLET_SIWE_URI`（預設 chiyigo.com）；新增 wallet.test.js（13 條：nonce/verify/list/delete 各 happy + 失敗分支 + 隔離；用 @noble 自簽 secp256k1 跑全鏈路驗章不靠 ethers）；prod migration 已 apply；108 unit + 379 integration 全綠。**前端 UI 還沒做**（要連 MetaMask / WalletConnect），等你決定方向再開 |
| 2026-05-05 | Phase E-2 risk-based authentication：functions/utils/risk-score.js 4 個 signal — country change(+35) / UA hash change(+20) / time-of-day anomaly(+15) / recent fails per email(+10/次 cap +30)；threshold 30 = medium audit warn / 70 = deny + email + critical audit；signal 來源全部走 D1（audit_log 撈最近 5 筆 auth.login.success / login_attempts 撈 30min fails），不引 KV / 不建表；fail-open（任何 query 失敗 score=0 不擋登入）；email.js 加 sendRiskBlockedAlertEmail 模板（含 score / factors / reset link / dashboard link）；hook 3 個 login 入口：local/login.js（密碼 verify ok 後）/ oauth/callback.js（profile fetch ok 後）/ webauthn/login-verify.js（assertion verify ok 後）—— 2fa/verify.js 不重複 check（password 階段已查），但寫入 ua_hash 給未來 signal；4 個 success audit 一律加 ua_hash + risk_score + risk_factors；新增 risk-score.test.js（11 條：4 signal 各自 + 累加 + helper + login 三段）；108 unit + 366 integration 全綠 |
| 2026-05-05 | D-3 UI 修補（commit `6898db8`）：D-3b/D-3c 重做到 `src/`（之前 `1f06065` 只改 `public/` 被 `npm run build` 蓋掉）；passkey login 按鈕高度配 OAuth grid；rename button 加上實際可見的 violet styling；2FA OTP 輸入框改用 `bg-[#0e0e12]`（已在 tailwind.css 內）；scripts/lint-handlers.js 加 passkey-login-btn 白名單。同時 dashboard.css 加 `.theme-light .dash-content input` override：解決 dashboard 11 個 input（包含刪帳密碼框、改名 / 移除 OTP 框、2FA setup OTP 框）在光模式下「黑底白字」突兀問題；autofill 也加 light mode 變體。寫 memory `feedback_src_vs_public_build.md`：規則「改 src/ 不是 public/，公 npm run build 一起 commit」。**待瀏覽器驗證**（user 排到 Phase E 後跑 + 此次 UI 修補一起驗）|
| 2026-05-05 | Phase D-3c：UI loop 補完。(A) login.html 加 passkey 登入入口（divider 與 OAuth grid 之間，full-width 紫色按鈕）；auth-ui.js 加 handlePasskeyLogin（login-options → navigator.credentials.get → login-verify；usernameless 可走 / 帶 email 走 narrow allowCredentials）；isSecureContext + PublicKeyCredential 偵測 → 不支援自動 hidden；login.css 加 .passkey-btn；auth-ui.js v13→v14；4 語 i18n keys（login_passkey_btn / passkey_logging_in / passkey_login_cancelled / passkey_login_fail）。(B) dashboard.js renderPasskeys 每 row 加「改名」按鈕 + inline rename panel（PATCH /credentials/:id 一般 access_token 不走 step-up；rename 與 remove panel 互斥開關）；openPasskeyRename 自動 select() 預填當前 nickname；成功後 in-place 更新 window._lastPasskeys cache + 重畫 list；4 語 6 個新 i18n keys；click delegation 加 3 個 handler；無 inline script，CSP hash 不需重算；108 unit + 355 integration 仍全綠（前端不影響後端）。Phase D 全部 UI 結案 |
| 2026-05-05 | Phase E-4 brute force 強化：(1) 同 user 漸進 cooldown — 30min 視窗失敗計數套階梯 5s/30s/5min/1hr（在 3/5/7/10 次點觸發）；(2) 同 IP 跨 user 偵測 — 1hr 內撞 ≥10 distinct email = credential stuffing → 24hr 黑名單；(3) login.js 加 1.5 IP 黑名單前置檢查（IP_BLOCKED 429 critical audit）+ 2.5 cooldown 檢查（COOLDOWN 429 帶 retry_after）+ 失敗分支兩處（unknown_user / bad_password）後 detectAndBlacklistCrossUserScan；migration 0022 建 `ip_blacklist`（PK ip + reason + expires_at + hit_count + 對應 INSERT...ON CONFLICT 累加）；schema_auth.sql + _setup.sql + _helpers.js 同步；admin/cron/cleanup 加清過期黑名單；不引 KV（同 E3）；新增 brute-force.test.js（16 條覆蓋 cooldown 5 階梯 + 隔離 / blacklisted 過期判斷 / 偵測 9 不寫 10 寫 / login.js 4 個接點含同 token 雙嘗試 → 第二次 IP_BLOCKED）；prod migration 已 apply（remote D1）；108 unit + 355 integration 全綠 |
| 2026-05-05 | Phase E-3 rate limiting at IdP（4 endpoints 統一限流，**未引 KV** — D1 ~5ms 對 auth 量級足夠，KV eventual consistency 對精確限流不友善）：(1) `/api/auth/local/login` 5/IP/min（保留 10/email/15min 防 credential stuffing）；(2) `/api/auth/refresh` 30/user/min（spec 寫 per-token，per-user 涵蓋更廣，持多 token 不能繞）；(3) `/api/auth/oauth/token` 10/IP/min；(4) `/api/auth/step-up` 5/5min → 3/min（金融操作 OTP 爆破防護緊一點）。`utils/rate-limit.js` 加 email scope 支援；refresh + oauth/token 走「先 check 後 record」pattern（每次 call 計數，不止 fail 才記）；4 個端點 429 都寫 audit warn (`auth.<endpoint>.rate_limited`)；新增 rate-limit-e3.test.js（7 條：refresh per-user 隔離 / oauth/token per-IP 隔離 / 計數含成功 call / email helper 過濾）+ 改 step-up 既有 5→3 + login 既有 20→5；108 unit + 339 integration 全綠。E1/E2/E4 待開 |
| 2026-05-05 | Phase D-4（**Phase D 全結案，後端側**）：異常裝置警示。新增 functions/utils/device-alerts.js 兩個偵測：(1) 新裝置 = user 過去無此 device_uuid（且非首登）→ audit `auth.new_device` critical（→ Discord）+ Resend email；(2) 跨國 IP 跳變 = 比對 audit_log 上一筆 auth.login.success.country vs request.cf.country → audit `auth.country_jump` critical（→ Discord，**不寄 email**：VPN/出國旅遊誤報率高）；email.js 加 sendNewDeviceAlertEmail 模板（HTML 含裝置/國家/時間 + Dashboard 引導）；4 個 login 入口（local/login + 2fa/verify + oauth/callback + webauthn/login-verify）統一補 `auth.login.success` audit 加 `country: request.cf?.country` 並 await safeAlertAnomalies；2fa/verify 的 issueToken 加 request/method 參數；request.cf 在 test 環境 undefined → checkCountryJump 直接 skip 不誤報；新增 device-alerts.test.js（11 條：web 跳過 / 首登跳過 / 熟識 device 跳過 / 新 device + audit + email / 沒 RESEND_API_KEY 不寄 / country jump 4 種分支 / 兩種同時觸發）；singleWorker 模式下 vi.mock 跨檔不穩 → 改攔 globalThis.fetch 觀察 api.resend.com 端點；108 unit + 332 integration 全綠 |
| 2026-05-05 | Phase D-3b 前端 dashboard 裝置管理 UI（**未經瀏覽器驗證**，code 已寫，需開 dev server 跑 golden path）：dashboard.html 加 sidebar/mobile-overlay nav + 兩個新 section（devices-section / passkeys-section，置於 changepw 與 email-banner 之間）；dashboard.js Object.assign(LANGS_D, ...) 補三十多個 i18n key 四語；新增 loadDevices/renderDevices/logoutDevice + loadPasskeys/renderPasskeys/addPasskey/openPasskeyRemove/cancelPasskeyRemove/confirmPasskeyRemove；瀏覽器 WebAuthn ceremony 自實作 b64urlToBuf/bufToB64url 不引 simplewebauthn/browser CDN（CSP 不增白名單）；passkey 移除走 inline OTP confirm panel + step-up('elevated:account', 'remove_passkey')；click delegation 加 6 個 handler（id passkey-add-btn + 5 個 data-action）；passkey 新增成功預設 nickname='我的 passkey'；isSecureContext 偵測 + 不支援時禁用按鈕；無新增 inline script / style → CSP 不需重算；lint 過、108 unit + 321 integration 仍全綠（前端不影響）。**請手動開 dev server 在 https 環境驗：** (1) 列出/排序裝置 (2) 登出單一 device 後 list 刷新 (3) passkey ceremony 成功 + 列表顯示 (4) 移除走 step-up OTP + jti 一次性 (5) 4 種語系切換 |
| 2026-05-05 | Phase D-3a 後端：dashboard 裝置管理 API。GET /api/auth/devices（refresh_tokens GROUP BY device_uuid，回 last_seen=MAX(auth_time) / first_seen / active_count / total_count；NULL = web；ORDER BY last_seen DESC NULLS LAST）+ POST /api/auth/devices/logout（device_uuid string|null；雙路徑 SQL：null 走 IS NULL，非 null 走 = 比對；先 SELECT 1 確認 row 存在不然 404 防探測；UPDATE WHERE revoked_at IS NULL；audit `auth.devices.logout` info 級含 device_uuid_prefix + revoked_count；無 step-up — 自登自裝置誤操作只是重 login）；新增 devices.test.js（10 條覆蓋 401/empty/排序/active vs total/型別錯/404/越權/idempotent/web 與 app 分流）；108 unit + 321 integration 全綠。前端 D-3b 待開（dashboard UI sections + i18n + step-up 刪 passkey modal） |
| 2026-05-05 | Phase D-2 Wave C（**Phase D-2 全部結案**）：Passkey 管理 endpoints。GET /api/auth/webauthn/credentials 列當前 user 全部 passkey（不回 public_key/counter）；PATCH /:id rename nickname（一般 access_token，雙欄 (id, user_id) 過濾防越權）；DELETE /:id 必須 step-up `elevated:account` + for_action='remove_passkey'，刪後寫 `webauthn.credential.deleted` critical audit；同 step-up token 第二次刪因 jti 黑名單 → 401（一次性消耗驗證）；新增 webauthn-credentials.test.js（9 條覆蓋 list/PATCH 越權/PATCH 太長/DELETE 三種 step-up 失敗+成功+jti 黑名單+越權 404）；108 unit + 311 integration 全綠。**D-2 完工進度：** Wave A schema+register / Wave B login(+amr) / Wave C 管理 = 19 個 test 全綠；後續只剩 D-3 dashboard UI（純前端） + D-4 異常裝置警示 |
| 2026-05-05 | Phase D-2 Wave B：WebAuthn / Passkey 登入 ceremony。POST /api/auth/webauthn/login-options（帶 email → allowCredentials；不帶 → usernameless / discoverable cred；email 不存在仍寫 challenge user_id=NULL 反帳號枚舉）+ login-verify（一次性消耗 challenge → JOIN credential+user → challenge user_id vs cred.user_id 不符走 critical audit → verifyAuthenticationResponse → UPDATE counter+last_used → 簽 access (含 amr=['webauthn'(,'mfa')]) + refresh，鏡射 local/login.js 的 web cookie / app JSON 分流；device_uuid + auth_time 寫 refresh_tokens；audit `auth.login.success` data 標 method=webauthn）；錯誤分支一律 401 同 message 反枚舉；新增 webauthn-login.test.js（10 條覆蓋 options 三模式 + verify 6 失敗分支 + happy + app device 路徑）；108 unit + 302 integration 全綠。Wave C credentials 管理 + dashboard UI 待開 |
| 2026-05-05 | Phase D-2 Wave A：WebAuthn / Passkey 註冊 ceremony。migration 0021（user_webauthn_credentials + webauthn_challenges；schema_auth.sql 同步）；裝 `@simplewebauthn/server@13.3.0`；utils/webauthn.js 加 getRpConfig/saveChallenge/consumeChallenge/listUserCredentials；新增 POST /api/auth/webauthn/register-options（產 PublicKeyCredentialCreationOptions + 寫 challenge）+ register-verify（一次性消耗 challenge → 驗 attestation → INSERT credential，含 nickname/aaguid/backup flags + transports JSON）；env vars `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGINS`（預設 chiyigo.com）；audit events：register.options/success/fail（user_id 搶 challenge 走 critical）；新增 webauthn-register.test.js（9 條覆蓋 happy / 401 / excludeCredentials / 4 種 fail 分支 / UNIQUE 409）；108 unit + 292 integration 全綠。Wave B 登入 ceremony 待開 |
| 2026-05-05 | Phase D-1 refresh token 強綁 device_uuid：refresh.js 加讀 `X-Device-Id` header（優先於 body.device_uuid，舊 client 保留向後相容）；mismatch → 撤銷整個 (user_id, device_uuid) 家族未撤銷 token + 寫 `auth.refresh.device_mismatch` critical audit（觸發 Discord webhook）；非該 device 的其他 token 不受波及；新增 tests/integration/refresh.test.js（5 條覆蓋 header/body/Web cookie/family revoke）；108 unit + 283 integration 全綠 |
| 2026-05-02 | 大改版：擴張到金融級平台（金流 + 虛擬貨幣 + 真錢遊戲），新增 Phase 0 / Phase E / Phase F |
