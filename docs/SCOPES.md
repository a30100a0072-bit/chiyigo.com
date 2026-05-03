# Scopes — chiyigo IAM

**版本**：1.0（2026-05-03）
**命名空間**：`<verb>:<resource>` 全小寫，冒號分隔

---

## 1. 命名規則

```
<verb>:<resource>[:<sub-resource>]
```

| Verb | 含義 |
|---|---|
| `read` | 讀取資源 |
| `write` | 修改 / 新增 / 刪除 |
| `admin` | 後台管理權限 |

新增 scope 必須 PR + 本 doc 更新；不接受 scope 散佈在各 client 的程式碼字串。

---

## 2. 標準 OIDC Scope

| Scope | id_token claim |
|---|---|
| `openid` | sub（必須）|
| `profile` | name / picture |
| `email` | email / email_verified |
| `offline_access` | 簽 refresh_token |

---

## 3. 平台 Scope

### 個人資料
- `read:profile` — 讀基本資料
- `write:profile` — 改顯示名稱、頭像
- `read:identity` — 讀社交帳號綁定
- `write:identity` — 綁 / 解綁社交帳號

### 站點專屬
- `read:chiyigo` — chiyigo.com 主站功能
- `read:mbti` — mbti 結果歷史
- `read:talo` — talo 占卜歷史

### Admin
- `admin:users` — 列 / 改 user 狀態（ban / unban）
- `admin:revoke` — revoke token
- `admin:audit` — 查 audit log

---

## 4. 預設 client scope 配置

| client_id | 預設 scope |
|---|---|
| `chiyigo-web` | openid profile email read:profile read:chiyigo |
| `mbti-web` | openid profile email read:profile read:mbti |
| `talo-web` | openid profile email read:profile read:talo |
| `dashboard-web` | openid profile email read:profile write:profile |
| `admin-web` | openid profile admin:users admin:revoke admin:audit |

---

## 5. Resource Server 驗證 helper（規範）

每個 endpoint 顯式宣告所需 scope，禁用「登入即萬能」：

```js
// functions/utils/scope.js（接 oauth_clients 表時上線）
export function requireScope(token, requiredScope) {
  const scopes = (token.scope || '').split(' ');
  if (!scopes.includes(requiredScope)) {
    throw new HttpError(403, 'insufficient_scope', { scope: requiredScope });
  }
}
```

---

## 6. 不可改的事（v1.0 鎖定）

- 既有 scope 字串（一旦發出 client 就鎖死）
- `<verb>:<resource>` 命名規則
- `admin:*` 命名空間用途（後台限定）

可新增 scope；可標 deprecated；不可重命名既有。

---

## 7. 維護紀錄

| 日期 | 事件 |
|---|---|
| 2026-05-03 | v1.0 初版（$0 精簡版） |
