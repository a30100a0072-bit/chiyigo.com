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

> ⚠ `step_up_token` 規格保留概念但目前**不實作**（沒有金流場景）。等真要做時依本文件擴充。

---

## 2. access_token Claim 規格

```jsonc
{
  "iss": "https://chiyigo.com",            // Issuer，未來搬子網域時靠此 claim 不變
                                            // → 若搬，全平台 RP 須同步改 issuer 比對字串（成本：3 個 RP，10 分鐘）
  "sub": "uid_abc123def456gh",              // 假名化 user ID（migration 0018）
  "aud": "chiyigo-web",                     // client_id
  "exp": 1234567890,
  "iat": 1234567890,
  "jti": "uuid-v4",                         // 唯一 ID，可 revoke
  "scope": "openid profile email read:chiyigo",
  "ver": 0,                                 // users.token_version；改值即全域 revoke
  "amr": ["pwd", "totp"]                    // 認證方式
}
```

### `sub` 規格（鎖定）

- 格式：`uid_<base32(random 10 bytes)>` 例：`uid_abc123def456gh`（16 char base32）
- 來源：`users.public_sub`（migration 0018）
- 一旦發出**永不變**
- ⚠ **不可**直接用 `users.id` 當 sub

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
- `sub` 格式：`uid_*` 前綴 + base32 隨機
- `aud` 用 client_id 字串（非 URL）
- claim 名稱與型別

新增 claim 可以；改既有 claim 名稱 / 型別不可。

---

## 7. 維護紀錄

| 日期 | 事件 |
|---|---|
| 2026-05-03 | v1.0 初版（$0 精簡版）|
