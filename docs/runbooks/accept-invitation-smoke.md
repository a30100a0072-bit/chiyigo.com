# Manual smoke — `/accept-invitation.html`

前端互動層無自動化 DOM/browser 測試框架（不為此引入 jsdom/happy-dom，見 §套件管理）。
連結↔頁面契約由 `tests/email.test.ts` 自動覆蓋；以下流程為**手動 smoke**，每次改動本頁
（`src/pages/accept-invitation.html` / `src/js/accept-invitation.ts`）後在無痕視窗跑一遍。

後端契約：`POST /api/invitations/accept` body `{ token }`，需 `requireRegularAccessToken`（受邀者本人登入）。

## ⚠️ 環境與資料（preview ≠ 安全沙盒）

本專案**沒有資料隔離的 preview 環境**，跑本 smoke 前務必知道：

- `wrangler.toml` 只有 **production** D1 binding（`chiyigo_db`，單一 `database_id`、**無 `preview_database_id`**）；KV / R2 / AI 也都是單一 production binding。
- `.github/workflows/deploy.yml` **只在 push 到 `main`** 時 deploy；**PR 不會自動產生 preview**。
- 因此 `wrangler pages deploy public --project-name chiyigo-com --branch <任意非 main>` 產生的是
  「**preview URL + 正式環境資料**」：page 只出現在該 preview alias（正式使用者看不到），但其
  Functions 綁的是 **production** D1/KV/R2。

⇒ **對 preview 跑本 smoke＝實際寫入正式 D1**（`invitations` / `organization_members` /
`event_outbox` / `audit_log` …）。一律當 **prod-data smoke** 處理，不是沙盒。要真正 isolated，
需在 Pages 專案另配 preview 環境的獨立 bindings（preview D1 + 對應 KV/R2），本 repo 目前無。

取得 smoke surface（merge 前；page 不進 prod-production）：

```
wrangler pages deploy public --project-name chiyigo-com --branch acc-inv-preview
# → 回傳 https://<hash>.chiyigo-com.pages.dev，對著它跑下方流程
```

> **Turnstile（登入頁機器人驗證，site key 綁網域）**：preview 登入若顯示「無法連線至網站／疑難排解」，
> 到 **Cloudflare Dashboard → Turnstile → site key `0x4AAAAAADISz6kSGZRC94TQ`（login + forgot-password 共用）
> → Hostname Management**，**只新增** `acc-inv-preview.chiyigo-com.pages.dev`、**不要**新增 `*.pages.dev`。
> ⚠ 這是**正式環境的 Turnstile widget**（同時守 chiyigo.com login / forgot-password）→ smoke 完**務必移除**
> 該 preview hostname，視為 cleanup 的一部分（見下方 Cleanup）。
> **raw token 安全**：信件連結指向 prod（`IAM_BASE_URL`→`chiyigo.com`，merge 前會 404）；smoke 時取
> 信件 raw token、只在本機無痕視窗**地址列**把 host 換成 preview 使用。**raw token 不要貼進聊天 / log / PR。**

> **Preview 自備 JWT 金鑰（auth smoke 前必做）**：preview 綁 prod D1，但 **dashboard 管理的 env secrets
> 是 per-environment 的，Production 設了 ≠ Preview 有**。缺 `JWT_PRIVATE_KEY` 時 preview 登入會在
> `signJwt` 拋例外 → 500（傳統症狀：有效帳密卻回 500 而非 401；traceId 進 Functions log、非 D1）。設法：
> - **產一組「專屬 preview」keypair**：`node scripts/generate-jwt-keys.mjs`（本機跑、輸出含 private `d`，
>   **不要**貼進聊天 / log / PR）。**絕不**把 **production** JWT private key 複製進 Preview。
> - `JWT_PRIVATE_KEY` → 設為 **Preview 的加密 Secret**（不可 plaintext / 不可 commit / 不可 log）。
> - `JWT_PUBLIC_KEY`（或 `JWT_PUBLIC_KEYS`）→ 設**同一次生成**的 public JWK（sign/verify 必須同對、kid 相符）。
> - `TURNSTILE_SECRET_KEY` 可不設（未設則 server 端 Turnstile skip，smoke 可接受）。
> - **設完 secrets 必 redeploy preview**（既有 deployment 不會自動吃新增 secret）。
> 好處：preview token 用 preview key 簽，**不對 prod 生效**，blast radius 收斂。

## 前置
- 一個 **fresh pending** 邀請（依下方「建議流程」用單一 invite 串完；token 成功接受後即消耗，勿用已接受過的）。
- 受邀者帳號：email 等於邀請的 email、**且已驗證**。
- 另一個無關帳號（測 wrong-account）。

## 建議流程：一個 invite 串完（最少 prod mutation）

invite 的 token 一旦成功接受就被消耗（之後只剩 replay），故用**單一 invite** 串完
#7 / #3 / #3b / happy，避免後面測到非 fresh-pending 狀態。raw token 從信件取得、只在地址列改 host：

1. 部署 preview；以測試 tenant owner 邀請你控制的測試 email（受邀者，email 已驗證）→ 信件取 raw token。
2. **無痕、登出狀態** → 地址列開 `https://<preview-host>/accept-invitation.html?token=<RAW>` → 應顯示「請先登入」面板。
3. 按「登入並接受邀請」→ 看地址列：應是 `/login.html`、**不含 token**（#7）。
4. 以**無關帳號**登入 → 自動回 accept → 按「接受邀請」→ 應 `INVITE_EMAIL_MISMATCH` 錯誤面板（#3）。
5. 按「改用其他帳號登入」→ 應顯示**登入表單**（**不可**彈回 accept＝迴圈；#3b）→ 以**受邀者**登入。
6. 自動回 accept → 按「接受邀請」→ **成功**（happy）；`organization_members` 該列 `status='active'`、`member.joined` audit。
7. （可選）再開同一連結 → 接受 → 仍成功（replay；#6）。

⇒ 此鏈一次覆蓋 #2b（登出→登入→回跳）/ #7 / #3 / #3b / happy，invite 只消耗一次。
缺 token（#4）、明暗 + i18n（#8）另外快速點一下即可，不需新 invite。

## 必跑路徑（逐條對照）

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

## Cleanup（prod-data smoke 跑完必做；對齊 PR2-5d 紀律）

因 smoke 寫進正式 D1，跑完只 **restore 測試狀態**：

- 刪掉本次測試建立的 invitation row，以及 accept 產生的 membership row（或把該測試 tenant 的
  membership 還原到 baseline）。
- **絕不刪 append-only**：`event_outbox` / `audit_log` / `*_ledger` / `event_deny_state` 的歷史列
  一律保留（與本 PR 原始任務約束一致）。
- **deny_state 不刪、也不要求 row count 回 baseline**（本 smoke 本就會新增 `event_deny_state` 列）：
  只核對相關 member stream 的**最終狀態不是錯誤 deny**（`member.joined` ⇒ undeny / `denied=0`）、
  `event_outbox` pending=0 / processing=0 / dead=0、`event_dlq` open=0、相關 users 仍 active。
- **Turnstile hostname 還原**：若為了過 preview 登入而把 `acc-inv-preview.chiyigo-com.pages.dev` 加進
  site key `0x4AAAAAADISz6kSGZRC94TQ` 的 Hostname Management，**smoke 完移除該 preview hostname**
  （那是正式 widget，不留 preview host）。**不要**加過 `*.pages.dev`。

## #3b 是本頁最易回歸的點
`goLogin()` 必須先 `sessionStorage.removeItem('access_token')` 再導去 `/login.html`；否則
`login-boot.ts` 看到舊 token 仍在會直接讀 `auth_redirect` 並 `location.replace` 回 accept 頁，
形成 accept→login→accept 迴圈，使用者永遠換不了帳號。改本頁登入導向邏輯時務必重測 #3b。
