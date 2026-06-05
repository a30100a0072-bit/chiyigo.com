# Manual smoke — `/accept-invitation.html`

前端互動層無自動化 DOM/browser 測試框架（不為此引入 jsdom/happy-dom，見 §套件管理）。
連結↔頁面契約由 `tests/email.test.ts` 自動覆蓋；以下流程為**手動 smoke**，每次改動本頁
（`src/pages/accept-invitation.html` / `src/js/accept-invitation.ts`）後在無痕視窗跑一遍。

後端契約：`POST /api/invitations/accept` body `{ token }`，需 `requireRegularAccessToken`（受邀者本人登入）。

## 前置
- 一個 **pending** 邀請（記下信件連結 `…/accept-invitation.html?token=<RAW>`）。
- 受邀者帳號：email 等於邀請的 email、**且已驗證**。
- 另一個無關帳號（測 wrong-account）。

## 必跑路徑

| # | 情境 | 步驟 | 預期 |
|---|---|---|---|
| 1 | Happy（已登入受邀者） | 以受邀者登入 → 開連結 → 按「接受邀請」 | 成功面板；`organization_members` 該列 `status='active'`；`member.joined` audit |
| 2 | 未登入 | 登出 → 開連結 | 直接顯示「請先登入」面板（非「接受」面板） |
| 2b | 未登入 → 回跳 | 接 #2 按「登入並接受邀請」 → 以受邀者登入 | 登入後**自動回到** accept 頁（token 還在）→ 可按接受 → 成功 |
| 3 | **Wrong account（迴圈防護）** | 以**無關帳號**登入 → 開連結 → 按「接受邀請」 | `INVITE_EMAIL_MISMATCH` 錯誤面板 |
| 3b | Wrong account → 換帳號 | 接 #3 按「改用其他帳號登入」 | **必須顯示登入表單**（不可 location.replace 彈回 accept 頁＝迴圈）；以受邀者登入後回到 accept → 接受 → 成功 |
| 4 | 缺 token | 開 `/accept-invitation.html`（無 `?token`） | 「缺少邀請 token」錯誤面板；「前往 Dashboard」可用 |
| 5 | 過期 / 撤銷 | 對 expired / revoked 邀請開連結 → 接受 | 對應錯誤句（過期 / 已處理過） |
| 6 | Replay（已是成員） | #1 成功後再開連結 → 接受 | 仍成功（idempotent，不重複加入） |
| 7 | login URL 不含 token | #2b / #3b 導去 login 時看網址列 | `/login.html`（**無** `?next=`/token）；token 只在 `sessionStorage.auth_redirect` |
| 8 | 明暗 + i18n | 切 dark/light、切 4 語（zh-TW/en/ja/ko） | 五面板皆正常套用、無殘留 key |

## #3b 是本頁最易回歸的點
`goLogin()` 必須先 `sessionStorage.removeItem('access_token')` 再導去 `/login.html`；否則
`login-boot.ts` 看到舊 token 仍在會直接讀 `auth_redirect` 並 `location.replace` 回 accept 頁，
形成 accept→login→accept 迴圈，使用者永遠換不了帳號。改本頁登入導向邏輯時務必重測 #3b。
