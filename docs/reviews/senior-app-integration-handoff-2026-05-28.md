# 銀髮 App ↔ chiyigo 平台整合 — 對接交接 / 契約確認

> **Salvage 註記（2026-06-15）**：本文件原屬 PR1 本地 work，PR1 squash（`06e7f72`）時未進 main、僅存於 `backup/local-main-before-sync-2026-05-30` 快照；今 salvage 回 `docs/reviews/` 以免隨 backup 清理遺失。**銀髮 App 對接仍延後**（該 App 尚有問題、未急上架），本文件留作**未來對接的契約/交接參考**，非 active 任務。下方內容為 **2026-05-28 原樣、未改寫**；其中對 current code 的契約快照（如 §5 token/OIDC）可能已隨後續 PR 演進，**對接前須以屆時 code 重新核對**。

- **建立日期**：2026-05-28
- **對象**：銀髮 App 開發團隊（chiyigo 平台 RP）
- **狀態**：🟡 **整合 HOLD** — 方向正確，但 RP-facing token 契約尚有 4 點未定案；整合 code 暫緩。觸發整合 = **PR1 上線 + 4 點契約定案**（§4）。
- **上游 SoT**：
  - 架構：`docs/reviews/chiyigo-platform-architecture-plan-2026-05-28.md`（✅ codex r5 full design gate）
  - PR1：`docs/reviews/pr1-tenant-foundation-plan-2026-05-28.md`（✅ codex Gate 1，實作中）
- **一句話**：先把自己的產品域寫完、把 `sub`/`tenant_id` 收斂成單一注入縫、凍結自建 auth；**現在別硬綁現行 token 的內部 id 值**。等 chiyigo 定案 4 點 + PR1 上線再開整合。

---

## 0. TL;DR

| 類別 | 結論 |
|---|---|
| **整體基調** | **整合 HOLD**（與 ERP 一致）。產品域業務 API 先寫完；整合 code 等契約定案。 |
| **做對、保持** | OIDC 走 chiyigo / ES256 pin / TenantGuard 取 token tenant 拒 header / relationshipId delegated-access fail-closed / billing 不自建 / deny-state 介面化。 |
| **必修事實誤解** | ① `aud` = 你們 client_id（`senior-app`），**不是** `'chiyigo'` ② **沒有 `tenant_type` claim**（改讀 `platform_role`）③ 驗章依 JWT header `kid` 選 key。 |
| **別硬綁** | `sub`、`tenant_id` 的**值空間未定案**（傾向改 public id）→ 各收斂成單一 adapter，禁散落存內部 id 字面值。 |
| **已定案可做** | 長輩=完整 chiyigo user / token 保持極小無 tenant_type / go-live 先 B2C。 |
| **等 chiyigo** | 4 點 RP 契約定案 + PR1 上線 + RP 註冊 + 後續 PR（org/invitation、event、Credit API、代建長輩帳號）。 |

---

## 1. 你們做對、請保持

- **OIDC 走 chiyigo、不自建 identity**：正確的 RP 定位。
- **ES256 + `algorithms:['ES256']` pin**：防 alg 降級，正確。
- **`TenantGuard` 取 token 的 tenant、拒 `X-Tenant-Id` header、缺 claim fail-closed**：完全對齊「tenant_id 一律來自驗章後 token，禁信 client」。
- **delegated-access：relationshipId-based、`resourceTenantId` 以 row 為準、無關係/非本 caregiver/撤/過期/scope 不符 → deny**：完全對齊架構 §8。
- **billing 標 OUT-OF-CONTRACT、不自建錢包**：正確，billing 是 chiyigo 的。
- **`DenyStateChecker` 介面 + Noop 預設**：介面方向正確（見 §4 #4 與 §6 C7）。

---

## 2. 必修事實誤解（與 hold 無關，無論如何都要對）

### 2.1 ⚠️ `aud` 是你們的 client_id，不是 `'chiyigo'`
chiyigo 簽給 RP 的 access_token，`aud` = 該 RP 註冊的 audience（例：`senior-app`），由 `redirect_uri` 解析決定。
- 驗章必須 `audience: '<你們的 client_id>'`。
- **驗 `aud==='chiyigo'` 會把自己所有 token 打回**；**完全不驗 aud 會吃到別的 RP（mbti/talo/sport-app）的 token = 跨 app auth 漏洞**。
- 這是 **Tier 0 audience 隔離硬約束**：RP 禁收 `aud=chiyigo` 的 token。
- 註：**註冊前**你們的 `redirect_uri` 不在白名單 → 解析會 fallback 成 `'chiyigo'`，你們拿到的會是 `aud='chiyigo'`（必須拒）。所以**註冊完成前無法跑 happy path**（見 §4 #1、§7）。

### 2.2 ⚠️ 沒有 `tenant_type` claim
access_token 帶的是 `tenant_id` + `platform_role`，**沒有 `tenant_type`**。
- `fromClaims` 讀的 `tenant_type` 請拿掉，改讀 `platform_role`。
- 要分 B2C/B2B 不靠 token（見 §3.2）。

### 2.3 驗章依 `kid` 選 key
JWT header 帶 `kid`，chiyigo 有多 key rotation 預備。
- 驗章要**依 header 的 `kid` 從 JWKS 選對應 key**（jose `createRemoteJWKSet` 會自動處理）。
- **別寫死取第一把 key**，rotation 時會驗失敗。

---

## 3. 已拍板 3 決策（2026-05-28，不受 hold 影響，可照做）

### 3.1 長輩 = 完整 chiyigo user
- 長輩有自己的 `user` / `sub` / personal tenant，**可由家屬代為註冊、可以從不登入、沒密碼、沒 OAuth**，但 identity 存在。
- `elder_relationships`：`elder_user_id` / `caregiver_user_id` 都是 chiyigo `sub`；**`resource_tenant_id` 指向「長輩的 tenant」，不是家屬的 tenant**（資料真正擁有者是長輩）。
- 模型：`caregiver(delegate) → delegated_access(resource_tenant_id = 長輩 tenant) → elder(resource owner)`。
- 理由：保住 `sub = actor identity` 不變式 → audit / trace / 權限 / 隔離 / 未來長輩自己登入（LINE / 政府 / 醫療串接）都不會爆炸。**不要**走「長輩只是 profile」。

### 3.2 token 保持極小，`tenant_type` 不進 token
- 維持 `{ sub, tenant_id, platform_role }` 核心 claim，不膨脹。
- RP 現階段**統一用 `tenant_id` 做隔離即可**，不需要區分 personal/org。
- 真要 tenant metadata（type / name 等）→ 未來走 **Tenant API**（尚未建，見 §9）。
- chiyigo 將定義 **JWT Claim Policy**（可進 token：security-critical / low-volatility / hot-path / immutable-ish；不可進：UI/onboarding state / mutable business metadata）。

### 3.3 go-live：B2C 先，B2B 架構就緒、實作後做
- **Phase 1（現在）**：只跑 B2C personal tenant 路徑。personal tenant 由 chiyigo 自動建，你們不做佈建。
- **Phase 2（之後）**：B2B organization（機構購買）。需 chiyigo 先補 org-create + invitation + member lifecycle（chiyigo PR4）。
- **關鍵指令**：產品端資料**一律 by `tenant_id` tenantized（不分 personal/org）** → B2B 來時零 migration。**別把 personal tenant 寫死成 single-user special case。**

---

## 4. RP-facing 契約 4 缺口（整合前 blocker；Owner = chiyigo）

未定案前 RP 無合法管道穩定取得 active tenant，**產品端不得開整合 code**。

1. **RP 拿哪顆 token、id_token 帶不帶 tenant claim**
   - 現行 code：RP access_token（`aud=<client>`）已帶 `tenant_id`+`platform_role`；**id_token 沒帶** tenant claim。
   - 待正式定案（id_token / access_token / userinfo / resolve-tenant endpoint 擇定）。
   - 硬約束：**RP 禁收 `aud=chiyigo` token**。
2. **`sub` 值空間** ⚠️
   - 現行 = `String(users.id)`（內部 id）。
   - 待定：內部 id vs `public_sub`（pairwise/public）。**有 public_sub 就不該讓 RP 存內部 id。**
   - → 你們以 `sub` 映本地 employee/elder 的外鍵，**先收斂成單一 adapter，別硬綁內部 id**。
3. **`tenant_id` 值空間** ⚠️
   - 現行 = 內部 `tenants.id` 整數。
   - 待定：內部 id vs 對外 public/stable tenant id（跨 repo 用）。
   - → `tenant_id` 同樣**收斂成單一注入縫**。
4. **deny-state / 撤銷事件格式**
   - membership suspend / hard-revoke 如何通知 RP（chiyigo PR4 deny-state + PR5 event outbox）。
   - 未定前 RP 靠 access_token ≤15min 過期收斂；**RP 的 deny-state 表必須對齊 chiyigo 最終事件格式，禁自己發明。**

> 另一現況限制（非缺口但須知）：RP 經 OIDC 拿到的 token，`tenant_id` **現階段一律是使用者的 personal tenant**。`org-switch` 目前只給 chiyigo 控制面（`aud=chiyigo`），**RP-scoped tenant 選擇是未來設計** → 再次印證「B2C 先」。

---

## 5. 現行 token / OIDC 契約快照（current code；未定案處已標註）

> ⚠️ 此為「現行實作快照」，非最終契約。`sub` / `tenant_id` 值空間見 §4 #2/#3，**勿硬綁**。

### 5.1 access_token claims
```jsonc
{
  "sub":            "123",            // STRING（現行=內部 user id 字串；值空間未定，§4#2）
  "tenant_id":      123,              // NUMBER（現行=內部 tenants.id；值空間未定，§4#3）
  "platform_role":  "tenant_owner",  // tenant_owner | tenant_admin | billing_admin | member
  "email":          "...",
  "email_verified": true,
  "role":           "player",         // 全域 IAM role，與 platform_role 正交；RP 通常用不到
  "status":         "active",
  "ver":            0,                // token_version（per-user）
  "scope":          "openid email read:profile write:profile",
  "iss":            "https://chiyigo.com",
  "aud":            "senior-app",     // = 你們 client_id（§2.1）
  "exp": 0, "iat": 0, "jti": "..."
}
```
- **無 `tenant_type`**。`sub` 是 string、`tenant_id` 是 number（型別不同別混）。

### 5.2 id_token claims（scope 含 openid 時加發）
```jsonc
{ "sub": "123", "auth_time": 0, "email": "...", "email_verified": true,
  "nonce": "...", "iss": "https://chiyigo.com", "aud": "senior-app", "exp": 0, "iat": 0, "jti": "..." }
```
- 現行 **id_token 不帶 tenant claim**（§4 #1）。

### 5.3 OIDC 端點（直接讀 discovery 自動配置，勿硬寫死路徑）
| 項目 | 值 |
|---|---|
| issuer（驗 `iss`） | `https://chiyigo.com` |
| discovery | `https://chiyigo.com/.well-known/openid-configuration` |
| JWKS | `https://chiyigo.com/.well-known/jwks.json` |
| authorize | `https://chiyigo.com/api/auth/oauth/authorize` |
| token | `https://chiyigo.com/api/auth/oauth/token` |
| userinfo | `https://chiyigo.com/api/auth/userinfo` |
| end_session | `https://chiyigo.com/api/auth/oauth/end-session` |

### 5.4 flow（Authorization Code + PKCE，public client 無 secret）
1. `GET /api/auth/oauth/authorize?response_type=code&redirect_uri=...&code_challenge=...&code_challenge_method=S256&state=...&scope=openid%20email&nonce=...`
2. 使用者登入 → `302` 回 `redirect_uri?code=...&state=...`
3. `POST /api/auth/oauth/token { code, code_verifier, redirect_uri }` → `{ access_token, id_token, refresh_token(native 才在 body), expires_in:900, ... }`
4. 驗 `id_token`（aud/iss/nonce/exp）；`access_token`（15min）打 API。
5. refresh：支援 `refresh_token` grant。
- 支援：`response_type=code`、`code_challenge_method=S256`、`token_endpoint_auth_methods=none`、`grant_types=authorization_code|refresh_token`、`scopes=openid|profile|email`。

---

## 6. 10 題逐題回覆

### A. Token / 簽章
- **A1 claim 形狀**：見 §5.1。重點：無 `tenant_type`（改 `platform_role`）；`aud=<client_id>`；`sub` string / `tenant_id` number；**值空間未定勿硬綁**。
- **A2 簽章演算法**：ES256 only，pin 正確；依 `kid` 選 key（§2.3）。
- **A3 discovery / issuer / JWKS / audience**：見 §5.3；audience = 你們 client_id（§2.1）。

### B. Tenant / 佈建
- **架構前提**：tenant / member / platform_role / tenant.type 的 SoT 是 chiyigo。**移除自建 `tenants`/`organization_members` 權威 + `POST /tenants`**；要本地投影只能是「從 chiyigo 同步來的唯讀快取」。
- **B4 佈建 + 初始 admin**：B2C → personal tenant chiyigo 自動建、初始 admin=本人，**你們不做佈建**；B2B → 等 chiyigo PR4（org-create + invitation）。
- **B5 tenant.type 如何判**：RP 現階段不需判（統一用 tenant_id 隔離）；未來走 Tenant API（§3.2）。

### C. 家屬 / 撤銷
- **C6 長輩是否 chiyigo user**：是，完整 user（§3.1）。長輩帳號怎麼建 → 等 chiyigo provision-on-behalf 流程（§9，現無 endpoint）；短期可先走既有註冊讓長輩有 sub + personal tenant。
- **C7 deny-state 來源**：Noop 現階段正確（chiyigo event outbox = PR5，尚未做）。**但 go-live 前必接真實 deny-state**（每 request 查、hard revoke 全 endpoint 即時生效）；事件格式**等 chiyigo，禁自己發明**（§4 #4）。
- **C8 delegated-access**：你們做法對齊架構 §8，保持。

### D. 維運 / Credits
- **D9 RP 註冊**：見 §7。
- **D10 credits API**：不自建 wallet/ledger/quota；保留 stub seam，等 chiyigo PR3 Credit API。契約預覽（以 PR3 為準）：中央 API 扣點、idempotency key 永久無 TTL、同 key 不同參數 → `409 IDEMPOTENCY_CONFLICT`、扣點 amount 必正整數、per-product quota、前端禁決定扣點成功。

---

## 7. RP 註冊清單（拿到部署 URL 後給 chiyigo）

| 欄位 | 值 |
|---|---|
| client_id | 建議 `senior-app` |
| aud | 通常 = client_id（`senior-app`）|
| origins（CORS） | 你們正式網域，例 `https://senior-app.pages.dev` |
| redirect_uris | Web → `https://.../auth/callback`；Native → 自訂 scheme `seniorapp://auth/callback`（desktop loopback `http://127.0.0.1:<port>/callback` 也支援）|
| post_logout_redirect_uris | 登出後回哪 |
| frontchannel_logout_uris / backchannel_logout_uri | 擇一或都給 |

- **client 型態：PKCE public client（無 client secret）**。Web SPA 與 Native 都是 public + PKCE(S256)。
- ⚠️ **目前 blocker**：銀髮 App 尚未發雲端、無 URL → authorize 會擋你們 redirect_uri，且註冊前拿到的 token 會是 `aud=chiyigo`（須拒）。**有 URL 再給清單，chiyigo 寫進 `oauth_clients` 並 purge cache（≤60s + KV 5min 生效）。**

---

## 8. 指令清單

### 現在做（不等 chiyigo）
1. **產品域業務 API 先寫完**（現階段主線）。
2. `tenant_id` **和** `sub` 各**收斂成單一注入縫（adapter）**；禁散落硬綁內部 id（值空間未定）。
3. **凍結自建 auth**（整合後是**刪除**、不是搬去 chiyigo）。
4. **移除自建 tenants/organization_members 權威 + `POST /tenants`**。
5. 確立長輩=完整 user；`delegated_access.resource_tenant_id` 指長輩 tenant。
6. 資料一律 by `tenant_id` tenantized（不分 personal/org），保留 organization 擴充能力但只實作 B2C 路徑。
7. 驗章層修對：`fromClaims` 去 `tenant_type` 讀 `platform_role`、`aud` 驗自己 client_id、依 `kid` 選 key（**但先別硬綁 sub/tenant_id 值**）。
8. `DenyStateChecker` 保留介面，**禁自己發明事件格式**；Credit / usage 保留 stub seam。

### 等 chiyigo（整合前 blocker）
9. **4 點 RP-facing 契約定案**（§4）。
10. **PR1 上線**。
11. **RP 註冊**（拿到 URL → 給 §7 清單）。
12. 後續 chiyigo PR：org-create+invitation（PR4）/ event outbox→deny-state（PR5）/ Credit API（PR3）/ 代建長輩帳號 provision-on-behalf（未排）。

---

## 9. 觸發整合的條件

**整合 Stage 1 啟動 = (PR1 上線) AND (§4 四點契約定案)**，兩者到齊才開整合 code。在那之前：產品域自走，整合面只做「§8 現在做」的隔離 / 凍結 / 收斂。

---

## 10. chiyigo 端新 backlog（本輪浮現，未排 PR）

| # | 項目 | 用途 |
|---|---|---|
| 1 | **provision-user-on-behalf** | 家屬代建長輩帳號的受控流程（現無專用 endpoint）|
| 2 | **JWT Claim Policy doc** | 明定可/不可進 token 的 claim 分類（§3.2）|
| 3 | **Tenant API** | 給 RP 拿 tenant_type / name 等 metadata（取代「把 tenant_type 塞 token」）|

> 既有 roadmap 已涵蓋：org-create + invitation + member lifecycle（PR4）/ event outbox → RP deny-state（PR5）/ Credit API（PR3）。
