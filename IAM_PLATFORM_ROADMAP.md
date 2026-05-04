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
> - **Phase 2**：consent UI + `max_age` + `id_token_hint` re-auth
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

- [ ] `verifyJwt` 加 audience 驗證
- [ ] Refresh cookie `Path=/api/auth/refresh`
- [ ] CSP 加 `object-src 'none'`
- [ ] grep 確認 access_token 不在 localStorage
- [ ] CSP 計畫移除 `'unsafe-inline'`（長期）

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
| 2026-05-02 | 大改版：擴張到金融級平台（金流 + 虛擬貨幣 + 真錢遊戲），新增 Phase 0 / Phase E / Phase F |
