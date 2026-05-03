# Client IDs — chiyigo IAM

**版本**：1.0（2026-05-03）
**命名規則**：`<product>-<platform>` 全小寫、連字號分隔

---

## 1. 命名規則

```
<product>-<platform>[-<env>]
```

| Segment | 範圍 |
|---|---|
| product | chiyigo / mbti / talo / dashboard / admin |
| platform | web / ios / android / desktop |
| env | （production 不帶）/ -dev / -staging |

**例**：
- `chiyigo-web`
- `mbti-web`
- `talo-web`

---

## 2. 既有 client 清單

| client_id | 域名 | app_type | require_pkce | 預設 scope |
|---|---|---|---|---|
| `chiyigo-web` | chiyigo.com | web | ✅ | openid profile email read:profile read:chiyigo |
| `mbti-web` | mbti.chiyigo.com | web | ✅ | openid profile email read:profile read:mbti |
| `talo-web` | talo.chiyigo.com | web | ✅ | openid profile email read:profile read:talo |
| `dashboard-web` | chiyigo.com/dashboard | web | ✅ | openid profile email read:profile write:profile |
| `admin-web` | chiyigo.com/admin | web | ✅ | openid profile admin:users admin:revoke admin:audit |

---

## 3. Client 屬性鎖定規則

### Public client（PKCE only，無 secret）— 目前全平台都是
- `client_secret_hash = NULL`
- `require_pkce = 1`
- `token_endpoint_auth_method = 'none'`

### Confidential client
- 目前**全平台無**
- 真要開啟（如 server-to-server backend）必須走 secret rotation 流程

---

## 4. Redirect URI 規則

| 規則 | 說明 |
|---|---|
| 完整 URL（含 scheme + host + path）| 不允許 wildcard |
| HTTPS only（`http://localhost` 例外）| dev 環境 |
| Path 完全比對 | `https://example.com/cb` ≠ `https://example.com/cb/` |
| 不接受 fragment redirect_uri | 統一走 query 參數 |

---

## 5. 上線新 client 流程

1. PR 更新本 doc + `oauth_clients` INSERT migration
2. 雙寫驗證：authorize.js 比對舊白名單 + 新表，差異 log 到 admin_audit_log
3. 跑 7 天無差異 → 切流到表
4. RP 端整合測試（discovery / authorize / token / userinfo / end_session）
5. 切流 production

### 下架 client
1. `is_active = 0`（軟下架）
2. 該 client 所有 active refresh_token revoke
3. 保留 row + audit history 1 年後再考慮 DELETE

---

## 6. 不可改的事（v1.0 鎖定）

- 既有 client_id 字串
- 命名規則 `<product>-<platform>`
- redirect_uri 完整比對規則

---

## 7. 維護紀錄

| 日期 | 事件 |
|---|---|
| 2026-05-03 | v1.0 初版（$0 精簡版）|
