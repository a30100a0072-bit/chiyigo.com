# JWT Spec — chiyigo IAM

**版本**：1.0（2026-05-03）
**簽章演算法**：ES256（P-256 ECDSA）
**JWKS**：`https://chiyigo.com/.well-known/jwks.json`

---

## 1. Token 種類

| Token | TTL | 用途 | 儲存 |
|---|---|---|---|
| `access_token` | 15 min | API 授權 | memory（**不入 localStorage**）|
| `id_token` | 15 min | OIDC 身分證明 | memory |
| `refresh_token` | 14 days（rolling）| 換 access_token | HttpOnly Cookie，子網域共享 |

> ⚠ `step_up_token` 已實作（金流 admin 動作必走，含 `for_action` 綁定 + atomic jti consume）。
> 詳見 `functions/utils/auth.ts#requireStepUp` + Codex 金流 r1 chain（main `b5e4aaf` 後上線）。

---

## 2. access_token Claim 規格

```jsonc
{
  "iss": "https://chiyigo.com",            // Issuer，未來搬子網域時靠此 claim 不變
                                            // → 若搬，全平台 RP 須同步改 issuer 比對字串（成本：3 個 RP，10 分鐘）
  "sub": "uid_abc123def456gh",              // 假名化 user ID（migration 0018）
  "aud": "chiyigo-web",                     // client_id
  "tenant_id": 1,                           // RP-facing tenant context（PR1 Tenant Foundation 起）
  "platform_role": "member",                // RP-facing tenant context（PR1 Tenant Foundation 起）
  "exp": 1234567890,
  "iat": 1234567890,
  "jti": "uuid-v4",                         // 唯一 ID，可 revoke
  "scope": "openid profile email read:chiyigo",
  "ver": 0,                                 // users.token_version；改值即全域 revoke
  "amr": ["pwd", "totp"]                    // 認證方式
}
```

> ℹ `tenant_id` / `platform_role` 是 PR1 Tenant Foundation 後 access_token 內的 **RP-facing tenant context claims**，由 server / DB 推導（見簽發點 tenant claims resolve）；**client 不可自宣告**，RP 僅讀取、不得信任前端傳入的同名值。

### `sub` 規格（contract：穩定 opaque identity string）

> 治理 SSOT：`chiyigo-core` `core/CORE_INVARIANTS.md` INV-1 + `adr/ADR-004`。
> **契約**：`sub` 是 opaque、不可變的身份字串，一旦發出**永不變**；消費者 / RP **禁假設其格式或型別**。

**雙態（current vs target，2026-05-29 校正）**：

- **Current impl（現況）**：`sub = String(users.id)`。
  - 簽發點 `functions/api/auth/local/login.ts`、`functions/api/auth/oauth/token.ts` 皆 `String(user.id)`。
  - `functions/utils/auth.ts#requireRegularAccessToken` 要求 sub 為正整數 `users.id`（fail-closed）。
- **Future migration target**：`sub = users.public_sub`（`uid_<base32(random 10 bytes)>`，例 `uid_abc123def456gh`；migration 0018）。
  - migration 0018 已加欄位，但 **step 4「JWT 簽發改用 public_sub」尚未完成**（implementation debt）。
  - **RP 整合前**完成 mig 0018 step 2–4 + 改簽發 + 更新 `requireRegularAccessToken` 解析。
- **RP 規則**：把 `sub` 當 opaque 字串存，**禁綁格式 / 禁假設是內部整數 id**；如此 users.id → public_sub 遷移對 RP 透明。

> ⚠ 本節上方 §2 / §3 / §4 範例中的 `"sub": "uid_..."` 是 **target 格式示意**；現行 runtime 實際簽 `String(users.id)`。

### `amr` 值

| 值 | 意義 |
|---|---|
| `pwd` | 密碼 |
| `totp` | TOTP（Google Authenticator）|
| `oauth_google` / `oauth_line` / `oauth_facebook` | 社交登入 |

---

## 3. id_token Claim 規格（OIDC 標準）

```jsonc
{
  "iss": "https://chiyigo.com",
  "sub": "uid_abc123def456gh",
  "aud": "chiyigo-web",
  "exp": 1234567890,
  "iat": 1234567890,
  "auth_time": 1234567880,                  // 實際登入時間（refresh 不變）
  "nonce": "client-generated-nonce",        // OIDC 必帶（防 replay）
  "amr": ["pwd", "totp"],

  // scope 包含時才帶
  "email": "user@example.com",              // scope=email
  "email_verified": true,
  "name": "顯示名稱",                        // scope=profile
  "picture": "https://..."
}
```

⚠ id_token **不是授權 token**。要呼叫 API 仍須 access_token。

---

## 4. refresh_token

```jsonc
{
  "iss": "https://chiyigo.com",
  "sub": "uid_abc123def456gh",
  "aud": "chiyigo-web",
  "exp": 1234567890,                         // 14 days
  "iat": 1234567890,
  "jti": "uuid-v4",                          // 每次 rotate 換新；舊 jti 立即進 revoked_jti
  "ver": 0
}
```

### Rotation 規則

- 每次 `/api/auth/refresh` 必發新 refresh + 撤舊
- 舊 refresh 5 秒內可用一次（容忍前端重試）
- 偵測 reuse（舊 jti 已 revoked 又被使用）→ 該 user 全裝置強登出 + audit `auth.refresh.reuse_detected` critical

---

## 5. 簽章與驗證

### 簽章
- ES256（P-256 ECDSA + SHA-256）
- header：`{ "alg": "ES256", "typ": "JWT", "kid": "<active key id>" }`
- 私鑰：Cloudflare Secret，永不入 D1，永不 log

### Key Rotation
- 每 90 天輪換（手動，docs/runbooks/secret-rotation.md）
- 新 key 上線時 JWKS 同時包含新舊兩把（kid 區分）
- 舊 key 在最後一張 token 過期後（15min）才從 JWKS 移除

### RP 驗證流程
1. 取 token header `kid`
2. 從 JWKS 取對應公鑰（KV cache 1hr）
3. 驗 ES256 簽章
4. 驗 `iss` == `https://chiyigo.com`
5. 驗 `aud` == 自己的 client_id
6. 驗 `exp` > now、`iat` ≤ now
7. （IdP 內部）驗 `jti` 不在 `revoked_jti`（KV cache 命中先返）

---

## 6. 不可改的事（v1.0 鎖定）

- `iss` 字串：`https://chiyigo.com`
- `sub` 是 **opaque、不可變、一旦發出永不變**的身份字串（內部表示 users.id → public_sub 的遷移屬已承諾 hardening，對 RP 透明；見 §2 `sub` 規格 + ADR-004）。消費者**禁假設 `sub` 格式**。
- `aud` 用 client_id 字串（非 URL）
- claim 名稱與型別

新增 claim 可以；改既有 claim 名稱 / 型別不可。

---

## 7. 維護紀錄

| 日期 | 事件 |
|---|---|
| 2026-05-03 | v1.0 初版（$0 精簡版）|
| 2026-05-29 | 校正 `sub` 規格與 runtime / governance 對齊：現況 `sub=String(users.id)`、target=`public_sub`（mig 0018 step 4 未完成）；移除「sub=public_sub 已鎖定」的 stale 宣告。對齊 `chiyigo-core` INV-1 / ADR-004。另補記：PR1 Tenant Foundation 起 access_token 新增 RP-facing tenant claims `tenant_id` / `platform_role`（§2）|
