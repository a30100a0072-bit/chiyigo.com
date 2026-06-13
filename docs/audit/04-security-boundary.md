# P4 安全邊界審計報告（Security Boundary）

> 領域：安全邊界 Security｜Tier-0 對應：**安全**（旁及 #4 Stability、#3 Correctness）｜SSOT：`00-invariants-threat-model.md` §2.1-2.5 / §3 安全邊界段 / §4。
> 不變量標的：INV-SEC-1..11。報告語言繁體中文；code identifier / 欄位名 / 路徑保留原文。
> **產出日期**：2026-06-13（Fable 5 審計窗 6/12–6/22）。方法：7 finder workflow 並行（`wf_f3de1587-402` / task `wvq6s2fn4`，4 矩陣 finder 鋪全 104 端點四欄矩陣 + 3 深潛 finder）→ 對抗式 verify（預設 refuted）→ 主線獨立讀碼裁決。
> **覆蓋完整性註記**：3 個 `dd-strong-auth` verifier 於昨夜撞 session limit 失敗（reset 2:20am Asia/Taipei）→ 該 3 條候選（含 headline P1）**由主線今日親自讀碼補裁**（register-verify / login-verify / login-options / credentials\[id] / wallet-verify / cleanup / bumpTokenVersion 全段獨立覆核），無覆蓋缺口。

---

## 0. 執行摘要

**整體姿態：身份/RBAC gate 面（INV-SEC-1）整面健全——104 端點四欄矩陣逐一驗證，無任何端點「漏呼叫 gate 而裸奔」。** 缺口集中在三類**非 gate** 軸：(a) **強認證因子的新增/移除 step-up 非對稱**（headline P1）、(b) **第二因子與 ceremony 端點的 rate-limit / 暴力破解觀測缺口**（reset-2FA brute force P1 + ceremony DoS P2）、(c) **enumeration / 觀測一致性**（admin/users PII 枚舉 P2）。token 機制核心（refresh rotation atomic batch、jwt ES256+iss+aud 鎖定、step-up jti atomic consume + DB-live 再驗、OAuth code DELETE...RETURNING 原子消費 + PKCE S256 強制 + redirect_uri exact match）在獨立讀碼下全部穩健。

**Headline（P1）：偷一次 15min access token → 永久帳號接管 + 繞過 2FA。** 新增認證因子（passkey 註冊 `webauthn/register-verify`、wallet 綁定 `wallet/verify`、**OAuth 身分綁定 `oauth/[provider]/init?is_binding=true`**）**只需 `requireAuth`（一般 access token），不需 step-up**；但移除 passkey/wallet 類因子（`credentials/[id]` DELETE、`wallet/[id]` DELETE）**卻需 step-up**。（OAuth 身分綁定的第三條路徑為 Codex 包準備時補發現，2026-06-13，落在 finder 切角之間的縫。）`reset-password` / `bumpTokenVersion` 強制下線時**不清除已註冊的 passkey / wallet**；passkey 登入（`login-verify`）重簽時讀 DB 當前 `token_version`、不受 bump 影響、也不檢查 `totp_enabled`。⇒ 攻擊者用被盜 token 註冊自己控制的 passkey 後，**改密碼 / 停 2FA / token_version bump 都殺不掉它**；若受害者未啟用 TOTP，連 step-up 都不可用（step-up 強制 `totp_enabled=1`），**無法經 API 移除這把 rogue passkey**。`2fa/activate` 明文要求 `current_password` 正是為了防被盜 token 接管，但新增更強、更持久的 passkey 因子卻無任何二次驗證——這條設計非對稱直接抵銷整個 step-up 威脅模型。

**8 條 findings（confirmed）+ 2 條對抗式駁回。** P3 細項另 13 條進 backlog。

| ID | 嚴重度 | 一句話 | 處置 |
|---|---|---|---|
| **SEC-FACTOR-ADD** | **P1** | 新增 passkey/wallet/**OAuth 身分**只需 requireAuth（移除才需 step-up）+ reset/bump 不清因子 + passkey 登入不檢查 2FA → 被盜 15min token 永久接管 + 繞 2FA（3 端點，第 3 條 OAuth binding 為 Codex 包準備時補發現） | 窗內修（§5；headline） |
| **SEC-RESET-2FA-BF** | **P1** | `reset-password` 的 TOTP 第二因子：失敗不消耗 token + 零 rate-limit + 零 audit → 1h token 窗內可無限暴破 ~333k 碼空間，破解即接管，全程靜默 | 窗內修（§5） |
| **SEC-REFRESH-REUSE** | **P1（需 owner 架構裁決）** | refresh reuse 偵測**不撤 token family** → 被盜 token 輪換後攻擊者保留 live 隱形 session、受害者反被踢；但 naive 修法會重開 Fork2 round-2 H 刻意關閉的反向向量（revoked token 反殺 live successor） | §5：先 owner 裁 tradeoff |
| **SEC-CEREMONY-DOS** | **P2** | `authorize` / `webauthn/login-options` / `login-verify` 匿名 + 無 rate-limit + 每請求寫 D1 row；`webauthn_challenges` **不在 cleanup 清單** → 無界灌爆 D1 寫入額度（破 $0 約束）+ 表永久膨脹（兩 finder 獨立命中） | 窗內修（§5） |
| **SEC-ADMIN-ENUM** | **P2** | `admin/users` GET 枚舉全站 email（PII）無 rate-limit、無 read-audit（與所有同類 list 端點不一致）；`metrics.ts` 另回 raw IP top-5 給 support | 窗內修（§5） |
| SEC-KYC-ENUM-2 | P3 | `resolveKycAdapter` 原型鏈鍵繞過 nullish 守門 → unauth TypeError 500（ISO-ENUM-2 同款，**本輪明確複查項，確認成立**） | backlog（與 ISO-ENUM-2 同批修） |
| SEC-CRON-TIMING | P3 | 8 支 cron + runner 用非 timing-safe `auth !== \`Bearer ${expected}\`` 比對 CRON_SECRET（6 處 inline 重複） | backlog |
| SEC-LOGOUT-CSRF | P3 | `/api/auth/logout` 豁免 CT gate + handler 無 Origin 檢查 + SameSite=None cookie → 任意跨站頁可強制登出受害者（DoS/annoyance 級） | backlog |

**對抗式駁回 2 條**（§4，駁回理由本身是 audit 價值）：IdP 鏈無 client_id 綁定（P2→駁回，PKCE S256 + redirect_uri exact match + per-aud token 已等價擋下 code injection，無可重現攻擊，最多降 P3 spec-compliance）；bind-email 以 body.aud 簽 token（P2→駁回，這是 5 個直接登入端點共用的標準 pattern，audience 隔離擋的是「跨 RP token 互打 resource API」而非「使用者為自己取 RP token」，無不變量違反）。

**另 13 條 P3 進 backlog**（§6）：register Turnstile fail-open（旁及 P7 config）、`getProvider` 原型鏈（目前不可達）、auth_code 鑄造無 audit、money refund/approve/delete 無 per-user rate-limit、reject/delete coarse↔fine scope 不一致、ban/unban/revoke 無 step-up（一致性）、ai/assist rate-limit read-then-act 非原子、公開 requisition 表單無 audit、money user 端點無 rate-limit、`2fa/activate` 不 bump token_version、oauth/code 無 rate-limit+audit、end-session 雙寫、frontchannel frame-src registry 信任面、silent SSO 不驗 device binding、2fa/verify 無顯式 banned 檢查 + 無 amr claim、password-reset/change-password 非原子（dd-token-lifecycle 提報 P2 → verifier 降 P3）。

---

## 1. 心智模型校準（對照 00 §2，INV-SEC-1..11 整面結論）

> 本節供小校準 Gate 驗「P4 對 codebase 安全邊界的理解是否正確」。每條標 INV + 一句話驗證結論。

| INV | 一句話 | 驗證結論 |
|---|---|---|
| **INV-SEC-1** 所有非公開 API 經 gate | 104 端點四欄矩陣逐一核 | ✅ **全綠**。無裸奔端點。public 端點（login/register/forgot/reset/refresh/logout/oauth token·authorize·callback/webhook/email-verify/delete-confirm/game-login）皆為**設計上公開**（credential exchange / token-IS-auth），各有對應 replay/單次性/rate-limit 補償（見矩陣） |
| **INV-SEC-2** access ≤15min；refresh rotation 安全 | refresh.ts atomic batch、successor_hash | ⚠ **rotation 機制本身穩健**（單一 db.batch 無 0-live-head 窗、reuse race 行級序列化、30s grace orphan read-only 分類），**但 reuse 偵測不撤 family → SEC-REFRESH（P1）**；強制下線不清認證因子 → SEC-FACTOR（P1） |
| **INV-SEC-3** step-up atomic consume | requireStepUp + consumeJtiOnce | ✅ INSERT OR IGNORE + changes===1 atomic acquire；DB-live 再驗 role/status/ver；for_action 綁定防跨用。**設計堅實**——SEC-FACTOR 的問題不在 step-up 本身，而在「該掛 step-up 的新增因子端點沒掛」 |
| **INV-SEC-4** brute force → rate limit + 鎖定 + 觀測 | login 三層防護 | ⚠ **password 軸滿（IP 黑名單 + per-IP/email RL + 漸進 cooldown + cross-user-scan）**，但 **reset-2FA 軸全缺（P1）**、**ceremony/passkey 軸全缺（P2）** |
| **INV-SEC-5** 防 replay | nonce / used_totp / jti / DELETE...RETURNING | ✅ TOTP used_totp PK、backup_code atomic、webauthn/SIWE challenge 單次消費、oauth code/state 原子消費——機制全對（reset-2FA 的問題是**沒限次**，非 replay） |
| **INV-SEC-6** input schema validation；webhook 驗簽 | 邊界 validation + ISO-ENUM 類 | ⚠ 整面健全，惟 `resolveKycAdapter`/`getProvider` 原型鏈鍵（ISO-ENUM-2 同根因，P3）；register Turnstile 未設時 fail-open（P3，旁及 P7） |
| **INV-SEC-7** output DTO；錯誤不洩 internal | 各端點 DTO 映射 | ✅ 全端點 field-mapped DTO，無 raw row dump；錯誤對外 code+traceId。惟 `admin/users`/`metrics` 缺 read-audit（觀測，P2/SEC-ADMIN-ENUM） |
| **INV-SEC-8** CRON bearer 比對 | 8 支 cron | ⚠ 比對**邏輯正確 + fail-closed**（`!expected`→500），但**非 timing-safe**（P3，門檻高） |
| **INV-SEC-9** refresh device-id read-only fail-closed | refresh.ts device guard | ✅ token 綁裝置而請求缺/不符 device → 撤 family（fail-closed）。惟 **silent SSO 路徑不驗 device binding**（P3，繞 rotation guard） |
| **INV-SEC-10** state-change 跨域受 Origin/CORS 控制 | CORS + CT gate | ⚠ 大面健全（refresh 因需 application/json 觸 preflight 被擋），惟 **logout 豁免 CT gate + 無 Origin 檢查 → 強制登出 CSRF**（P3，DoS 級） |
| **INV-SEC-11** secrets 不 hardcode | 走 env | ✅ 全走 env / Wrangler secret（PAY-002 已修 fail-closed） |

**校準結論**：00 §2.1-2.5 心智模型**正確無誤讀**。§2.2 token taxonomy（regular/pre_auth/temp_bind/elevated）與 §2.3 雙 role 軸正交性在端點層全部成立；本輪所有 finding 都是**既有 pattern 的覆蓋不一致**（某端點漏掉同 codebase 別處已建立的防護），非心智模型錯誤。

---

## 2. 四欄矩陣（gate × validation × rate-limit × audit）

**全 104 端點完整矩陣**留存於 workflow 輸出 artifact（`tasks/wvq6s2fn4.output`，4 矩陣 finder 各自的 `matrix` 陣列；temp 檔，可能輪替清除）。本節只列**四欄有缺口的 ⚠ 端點**（gate 欄全綠故不列；缺口端點即下方 findings 的證據基礎）。

| 端點 | gate | validation | rate-limit | audit | 缺口 → finding |
|---|---|---|---|---|---|
| `webauthn/register-verify` | requireAuth ✅ | ✅ | none | register.success ✅ | **缺 step-up（新增因子）→ SEC-FACTOR P1** |
| `wallet/verify` | requireAuth ✅ | ✅ | none | bind.success critical ✅ | **缺 step-up（綁定金流前置因子）→ SEC-FACTOR P1** |
| `oauth/[provider]/init?is_binding` | requireAuth ✅ | ✅ | oauth_init 10/IP ✅ | none ⚠ | **缺 step-up（綁新 OAuth 登入身分）→ SEC-FACTOR P1（第 3 路徑）** |
| `local/reset-password` | token-IS-auth ✅ | ✅ | **TOTP 步驟 none** | **TOTP-fail 無 audit** | **2FA 暴破 + 零觀測 → SEC-RESET-2FA-BF P1** |
| `auth/refresh` | refresh+device ✅ | ✅ | refresh 30/min ✅ | 完整 ✅ | reuse 分支不撤 family → SEC-REFRESH P1 |
| `webauthn/login-options` | public ✅ | ✅ | **none（匿名）** | none | **無界寫 D1 + 不在 cleanup → SEC-CEREMONY-DOS P2** |
| `webauthn/login-verify` | public ✅ | ✅ | **none** | login.success ✅ | passkey 軸無 RL/暴破觀測 → SEC-CEREMONY-DOS P2 |
| `oauth/authorize` | public ✅ | ✅ | **none** | **silent SSO 無 audit** | 無界寫 pkce_sessions → SEC-CEREMONY-DOS P2 |
| `admin/users` GET | requireAnyScope(users:read) ✅ | ✅ | **none** | **none（無 read-audit）** | **PII 枚舉無痕 → SEC-ADMIN-ENUM P2** |
| `admin/metrics` GET | requireAnyScope(users:read) ✅ | ✅ | none | **none + raw IP top-5** | 同 SEC-ADMIN-ENUM P2 |
| `webhooks/kyc/[vendor]` | sig-in-adapter ✅ | vendor 派發 ⚠ | none | kyc.fail/change ✅ | 原型鏈鍵 500 → SEC-KYC-ENUM-2 P3 |
| `auth/logout` | refresh-IS-auth ✅ | ✅ | none | logout ✅ | CT 豁免 + 無 Origin → SEC-LOGOUT-CSRF P3 |
| `admin/cron/*`（8 支） | CRON_SECRET ✅ | n/a | n/a | 各自 ✅ | 非 timing-safe → SEC-CRON-TIMING P3 |
| `oauth/code` | requireAuth ✅ | ✅ | **none** | **none** | auth_code 鑄造無觀測 → P3 backlog |
| `local/register` | public ✅ | ✅ | **Turnstile only** | register ✅ | Turnstile fail-open → P3 backlog（旁及 P7） |
| money: `refund`/`approve`/`delete`/`reject` | step-up+scope ✅ | ✅ | **none** | 各自 ✅ | 無 per-user RL（vs billing 有）→ P3 backlog |
| money user: `refund-request`/`requisition/revoke`/`requisition/[id]`DELETE | requireAuth ✅ | ✅ | **none** | 部分 | 無 RL → P3 backlog |

**矩陣正面結論**（無 finding，記錄供 Gate 對照）：`2fa/activate` 要 current_password、`step-up` 要 totp_enabled+OTP、`change-password`/`delete`/passkey·wallet delete 要 step-up、`org-switch` tenant_id 經 DB-live `resolveIssuanceContextForTenant`、`payments/intents/[id]` 雙欄 id+user_id 過濾防 IDOR、`userinfo` aud=null 為刻意跨 aud OIDC、`me` DB-live banned 覆寫 JWT snapshot、`game/login`/`identity/unbind`/`oauth init` 的 provider 派發走 `Array.includes`/`Set.has` 白名單（**非**原型鏈鍵）——全部正確。

---

## 3. Finding 詳述

### SEC-FACTOR-ADD（P1）— 新增認證因子無 step-up → 被盜 token 永久接管 + 繞 2FA【headline】

```
ID         : SEC-FACTOR-ADD
領域        : Security
嚴重度      : P1（有前置〔被盜 access token〕但可成立的 Tier-0；step-up 威脅模型自身假設此前置）
違反條款    : INV-SEC-1（敏感操作授權一致性）+ INV-SEC-5（persistence）+ Tier-0 Security
證據        : functions/api/auth/webauthn/register-verify.ts:38（新增 passkey 只 requireAuth）+ :81（requireUserVerification:false → 可用非 UV/虛擬 authenticator）
            functions/api/auth/wallet/verify.ts:41（綁 wallet 只 requireAuth）
            **第三條路徑（Codex 包準備時補發現，2026-06-13）**：functions/api/auth/oauth/[provider]/init.ts:112-116（is_binding=true 綁新 OAuth 身分只 requireAuth）+ functions/api/auth/oauth/[provider]/callback.ts:121-153（callback 綁定模式 INSERT user_identities(user_id, provider, provider_id)）→ 攻擊者用自己的 Google/Discord 帳號綁到受害者 user_id，之後該 provider 登入即以受害者身份發 token（OAuth 登入路徑 callback.ts:237+ 不需密碼、重讀當前 token_version）。**此路徑落在 finder 切角之間的縫**（dd-strong-auth 只看 passkey/wallet、dd-oauth 看 callback 但未框成 factor-add P1）→ ADD-A scope 應含此第三端點。
            對照（非對稱反證）：functions/api/auth/webauthn/credentials/[id].ts:74（DELETE 需 requireStepUp(ELEVATED_ACCOUNT,'remove_passkey')）+ :8-10 註解自承「delete=移除 second factor，等同改密碼強度，必須走 step-up」
                              functions/api/auth/wallet/[id].ts:32（解綁需 step-up）
                              functions/api/auth/2fa/activate.ts（啟用 2FA 需 current_password 防被盜 token 接管）
            注：identity/unbind 為 requireAuth + last-auth-method guard（非 step-up），故 OAuth 身分軸 add/remove 皆 requireAuth——對稱性與 passkey/wallet（remove 需 step-up）不同，但 add 側同樣是「被盜 token 即可植入永久登入因子」
            持久性：functions/utils/auth.ts:109-117 bumpTokenVersion 只 bump token_version + 撤 refresh_tokens，**不刪** user_webauthn_credentials / user_wallets（grep 確認唯二 DELETE 點是兩個 step-up delete 端點）
            functions/api/auth/local/reset-password.ts:144-160 reset 密碼亦不清因子
            functions/api/auth/webauthn/login-verify.ts:220（重簽讀 DB 當前 token_version → 不受 bump 影響）+ 全檔不檢查 totp_enabled
            functions/api/auth/step-up.ts:108（step-up 強制 totp_enabled=1）
重現情境    : 攻擊者竊得受害者 15min access token（XSS / token theft — 即 step-up 機制假設並防禦的威脅）：
            1. 用自己控制的 software/虛擬 authenticator（attestation='none'，完全控制 authenticatorData 的 rpIdHash + clientDataJSON 的 origin）對 register-options(requireAuth) + register-verify(requireAuth) 鑄一把 passkey；access token 走 Authorization header（攻擊者持有），整個 ceremony 可離線偽造、無需在 chiyigo.com 載頁。
            2. 此後攻擊者用 login-verify 永久登入：(a) 繞過受害者 TOTP（passkey 登入不檢查 totp_enabled）；(b) 受害者改密碼 / 停 2FA / admin bumpTokenVersion 皆不清此 passkey，login-verify 讀當前 token_version 重簽仍有效；(c) 若受害者未啟用 TOTP → step-up 不可用 → 連 API 都無法移除這把 rogue passkey。
            wallet 變體：綁攻擊者 wallet → 未來提款/對帳目的地接管（金流前置）。
blast radius: 全帳號永久接管 + 2FA 繞過（passkey）；提款目的地接管（wallet）。**survives password reset / 2FA disable / token_version bump** — 標準補救手段全失效。
修復方向    : register-verify、wallet/verify **與 oauth init is_binding** 三端點比照 delete 端點改 requireStepUp(ELEVATED_ACCOUNT, 'add_passkey'/'bind_wallet'/'bind_identity')，或至少要求 current_password 再驗（對齊 2fa/activate）。並評估 reset-password / bumpTokenVersion 強制下線情境是否一併撤銷/標記「非當前 session 註冊」的因子。**ADD-A 封閉 live P1 = 三端點 step-up + 一次性盤點既有 passkey/wallet/user_identities**。
信心度      : high
需 Gate 複核: yes（auth/step-up 熱區）
建議修者    : Opus（窗內 Dual Gate）
```

**主線裁決（補驗，verifier 因 session limit 缺席）**：confirmed P1。三項機制全部讀碼坐實（add 僅 requireAuth、remove 需 step-up 的非對稱；bump/reset 不清因子；login-verify 不檢查 2FA 且讀 DB 當前 ver）。對抗式覆核「能否離線偽造 register 回應」：能——軟體 authenticator + attestation='none' 下 `verifyRegistrationResponse` 只驗 rpIdHash 與 expectedOrigin 相符（無 attestation root 可比對），攻擊者完全控制這兩者；access token 在 header。故攻擊路徑真實。嚴重度 P1 正確（前置=被盜 token，正是 step-up 自身威脅模型；非無前置即打任意帳號故非 P0；非觸發不了故非 P2）。

### SEC-RESET-2FA-BF（P1）— reset-password 第二因子無限暴破 + 零稽核

```
ID         : SEC-RESET-2FA-BF
領域        : Security
嚴重度      : P1（INV-SEC-4 brute-force + INV-SEC-7 觀測雙違反；前置=reset 流程自身威脅模型）
違反條款    : INV-SEC-4（brute force → rate limit + 觀測）+ Tier-0 Security；旁及 INV-SEC-7（失敗無 audit）
證據        : functions/api/auth/local/reset-password.ts:25-138（全函式無 checkRateLimit import/呼叫）
            :84-87 TOTP 走 verifyTotpReplaySafe 但**失敗時不消耗 token**（token 僅在 backup_code 路徑 :90-99 或最後 :128-138 atomic 消耗）
            :124 `if(!passed) return res({code:'INVALID_OTP'},401)` **無 safeUserAudit**
            functions/utils/totp.ts:24-50 verifyTotpReplaySafe 對猜錯（delta===null）直接 return，從不寫 used_totp、不鎖定、不限次
            functions/api/auth/local/forgot-password.ts reset token TTL=1 小時
            決定性對照：functions/api/auth/2fa/verify.ts:66-77（同一 verifyTotpReplaySafe 在登入態有 checkRateLimit kind='2fa' 5/5min + recordRateLimit + mfa.totp.verify.fail audit）→ 證明此防護是 codebase 既定 convention，reset 路徑遺漏=真缺口
重現情境    : 前置=攻擊者取得受害者一封有效 reset link（email 被攻陷/攔截 — 正是 reset 強制 2FA 要防的情境）。對 POST /api/auth/local/reset-password 重複送同一 token + 猜測 6 位 totp_code：失敗不消耗 token、無 rate-limit、無 audit → 同一 token 在 1h TTL 內可無限重試。有效碼空間（window=1，prev/cur/next ~3 碼/10^6）期望 ~333k 次猜中；破解後即重設密碼 + bumpTokenVersion 接管。全程 audit_log 靜默（TOTP-fail 無 emitter）。
blast radius: 任何啟用 2FA 且 email 被攻陷的帳號；2FA-on-reset 的核心防護目的被抵銷；對帳/偵測層看不到攻擊。
修復方向    : reset-password 的 2FA 驗證步驟前加 per-user/per-token rate-limit（沿 rate-limit.ts 新增 kind 如 'reset_2fa'，例 5/5min，registry union 同步補）；TOTP 失敗路徑補 safeUserAudit('account.password.reset.totp_fail', warn)；可考慮連續失敗達上限即作廢該 reset token（與 backup 路徑單次語意一致）。
信心度      : medium（finder）→ high（verifier 親讀升級，攻擊路徑全成立）
需 Gate 複核: yes（auth 熱區）
建議修者    : Opus（窗內 Dual Gate）
```

**verifier 裁決**：confirmed，keep P1。三項核心 claim（無 RL / 失敗不消耗 token / TOTP-fail 零 audit）親讀全成立；同一 verifyTotpReplaySafe 在 2fa/verify 有完整 RL+audit 證明是既定 convention 遺漏。migration 0011 已備 kind='2fa' bucket，新增 'reset_2fa' 成本極低。

### SEC-REFRESH-REUSE（P1 — 需 owner 架構裁決）— reuse 偵測不撤 token family

```
ID         : SEC-REFRESH-REUSE
領域        : Security
嚴重度      : P1（critical path defense-in-depth 缺口；前置=token theft）
違反條款    : INV-SEC-2（refresh rotation：reuse → family 撤銷）+ OAuth refresh-rotation BCP；Tier-0 Security
證據        : functions/api/auth/refresh.ts:130-168（revoked-token 分支：grace 與 genuine-reuse 皆只 audit + 401，**無任何 family revoke**）
            :164-165 註解自承「refresh rotation 設計下偷 token 必中此分支」卻未撤 family
            :185-209 唯一的 family revoke 只在 LIVE-token 的 device_uuid 不符路徑（web token device_uuid=null 故恆不觸發）
            functions/utils/session-revoke.ts:42-62 casByFamily 可精準撤該 per-login family（技術上可行修法）
重現情境    : Web session（device_uuid=null）。攻擊者竊得 live refresh token R_n → 搶先 refresh：S1 撤 R_n、S2 插新 head H_atk（攻擊者持 live）。受害者隨後 silent refresh 帶舊 R_n → 進 revoked 分支 → 超出 30s grace 或 successor 已被用 → reuse_detected → 受害者 401 被登出，**但 H_atk 仍 live 可無限 rotate**。RFC 6819/oauth-security BCP 的「reuse → 撤整 family」正用於殺 H_atk，此處缺席 → 攻擊者持久隱形平行 session、受害者誤以為只是「被登出重登一次」。
blast radius: 所有 web session（device_uuid=null，主要瀏覽器用戶）+ 同裝置受害的 App session。
修復方向    : **⚠ 此 finding 有設計張力，不可照 finder 描述直接 splice casByFamily。** docs/reviews/fork2-rotation-grace-plan.md:25-31「Binding invariant (Codex round-2 H)」明文裁定 revoked/grace 路徑對 refresh_tokens **READ-ONLY、MUST NOT family-revoke**，理由=擋對稱情境（Ordering B：受害者搶先 refresh、攻擊者拿被撤舊 token replay → 若此處 family-revoke 會反殺受害者 live session，且 benign network-orphan 也誤殺）。正解貼近 OAuth BCP（reuse→撤 family，接受 benign re-login）但需 owner/架構裁決此 tradeoff。
信心度      : high
需 Gate 複核: yes（refresh rotation 熱區 + 推翻既有 ratified 決策，**必送 Codex + 需 owner ruling**）
建議修者    : Opus（owner 裁 tradeoff 後）
```

**verifier 裁決**：confirmed，keep P1，**但 finder 嚴重低估這是「兩條 Tier-0 對撞」（theft 持久化 vs revoked-token 武器化/self-DoS）而非單純漏寫**。machine 路徑全核實（per-login session_id 鑄造 + rotation PRESERVE + casByFamily 可精準撤 H_atk）。Fork2 round-2 H 的 inline 立場是「刻意不撤」，本 finding 指出的是該決策的後果，屬對 ratified tradeoff 的挑戰——**§5 列為「先 owner 裁，再 Dual Gate」**，不照 naive 修法執行。

### SEC-CEREMONY-DOS（P2）— ceremony 端點匿名無界寫 D1 + challenge 表不在 cleanup

```
ID         : SEC-CEREMONY-DOS
領域        : Security（Tier-0 #4 Stability + $0 Cloudflare 硬約束）
嚴重度      : P2（現可觸發的 availability/成本缺口；assertion 密碼學不可暴破故非帳號接管）
違反條款    : INV-SEC-4（rate limit + 觀測）+ Tier-0 #4 Stability（availability under expected load）+ $0 D1 寫入額度
證據        : functions/api/auth/webauthn/login-options.ts:30-63（public，無 requireAuth/checkRateLimit/turnstile；:57 saveChallenge **無條件**寫 webauthn_challenges，連 email 不存在也照寫＝反枚舉刻意設計）
            functions/api/auth/oauth/authorize.ts:135（每次 INSERT pkce_sessions，無節流）
            functions/api/auth/webauthn/login-verify.ts（全檔無 rate limit）
            functions/api/admin/cron/cleanup.ts:21-80 TASKS **完全無 webauthn_challenges 清理 task**（只清 pkce_sessions/auth_codes/oauth_states/email_verifications/refresh_tokens/revoked_jti/login_attempts/ip_blacklist/wallet_nonces/kyc_webhook_events/payment_intents）→ 洪泛下未消耗 challenge 永久累積
            對照：functions/api/auth/oauth/[provider]/init.ts:80-91 已用 oauth_init kind（10/IP/60s）對 oauth_states 寫入節流 — 證明 pattern 存在但 authorize/login-options/login-verify 漏覆蓋
重現情境    : 未驗身分攻擊者對 POST /webauthn/login-options 或 GET /oauth/authorize 無限打 → 每請求各寫一筆 webauthn_challenges / pkce_sessions，無上限 → 灌爆 D1 每日寫入額度（破 $0）+ 表膨脹（webauthn_challenges 無排程 GC → 永久累積；pkce_sessions 日級 cleanup 對單次 burst 仍可膨脹 ~24h）。assertion 密碼學上不可暴破，故 blast 為可用性/成本而非接管。
blast radius: 未驗身分公開面；D1 寫入額度/availability（共用 chiyigo_db）+ passkey 登入路徑暴破觀測缺口。
修復方向    : 為 authorize（pkce_session 寫入）、login-options（challenge 寫入）、login-verify 補 per-IP rate limit（沿 init.ts oauth_init pattern）；RateLimitKind 加 'webauthn'/'pkce_session' kind；cleanup.ts TASKS 補 `DELETE FROM webauthn_challenges WHERE expires_at < datetime('now')`（對齊 wallet_nonces 那條）。
信心度      : high（兩 finder：mx-auth-proto + dd-strong-auth 獨立命中）
需 Gate 複核: yes
建議修者    : Opus（窗內 Dual Gate）
```

**裁決**：mx-auth-proto verifier confirmed P2（親讀全核實 + 加重發現 cleanup 缺 webauthn_challenges）。dd-strong-auth:1 同一問題的 login-options 變體，主線補驗同 confirmed（cleanup.ts 確認不含該表）。合併為單一 finding。

### SEC-ADMIN-ENUM（P2）— admin/users 枚舉全站 email 無 rate-limit 無 read-audit

```
ID         : SEC-ADMIN-ENUM
領域        : Security（Tier-1 #7 Observability + INV-SEC-7/4）
嚴重度      : P2（觀測/最小知情面缺口；reader 本被授權逐頁看，缺口是 bulk 枚舉無痕無限速）
違反條款    : INV-SEC-7（output/觀測）+ INV-SEC-4（enumeration 觀測）+ Tier-1 #7 Observability
證據        : functions/api/admin/users.ts:19-78（整檔無 import safeUserAudit、無 checkRateLimit；GET 回 email/role/status 分頁可枚舉）
            functions/api/admin/metrics.ts:46-68,113-118（無 read-audit + 回 login_attempts.ip 原文 top-5）
            對照組均有兩者：deals.ts:41-46+101、requisitions.ts:33-41+90、payments/intents.ts:61-66+139、requisition-refund.ts:53-58+95、audit.ts:68-73+138
            actor 可達：scopes.ts:198-203 support role 含 admin:users:read；requireAnyScope 接受任一 → support 或外洩 admin:users:read token 皆可呼叫
重現情境    : support role（或外洩的 admin:users:read token）對 /api/admin/users?page=N 連續分頁把全站 email 撈光：(a) 無 admin_read rate-limit 不限速、(b) 無任何 audit_log row 記錄誰在何時枚舉 → 事後無法回答「誰把 email 清單抓走了」。metrics.ts 另回 raw IP top-5。
blast radius: 全站 user email + role + status（PII）可被任一 admin:users:read 持有者無痕無限速枚舉；metrics 另洩 raw IP。屬觀測/最小知情面缺口，非直接資料毀損。
修復方向    : users.ts 補 admin_read rate-limit + 一筆 admin.users.read 觀測 audit（含 filters + result_count，對齊 deals/audit 形狀）；metrics.ts 補 read-audit、回傳 IP 改 hash 或限 super_admin。first-do-no-harm 最小 diff。
信心度      : high
需 Gate 複核: yes
建議修者    : Opus（窗內 Dual Gate）
```

**verifier 裁決**：confirmed，keep P2。非偽陽性（不在 known-false-positives）；對照組 5 個同類 list 端點皆有 RL+read-audit 並帶「對齊」inline 註解 → 確立 house pattern，users.ts（PII 密度最高）獨缺。

### P3 細項（進 backlog，§6 列全清單）

本節僅展開兩條較具操作意義的 P3，其餘 11 條濃縮於 §6 backlog 表。

**SEC-KYC-ENUM-2（P3，本輪明確複查項）**：`functions/utils/kyc.ts:204,210-212` `resolveKycAdapter` 用 `ADAPTERS[vendor] ?? null`（純物件字面量）。vendor 為 user-controlled path param，`.toLowerCase()` 後 `__proto__`/`constructor` 仍命中原型鏈 → 回 truthy 的 Object 方法繞過 `if(!adapter)` 400 守門 → `adapter.parseWebhook`（undefined）→ TypeError → `_middleware` 變 500（誤觸 5xx Discord 告警）。POST `/api/webhooks/kyc/__proto__` 即重現。**無 auth 繞過**（簽章在 adapter 內，根本到不了），純 robustness/observability bug，與已入 backlog 的 ISO-ENUM-2（`resolvePaymentAdapter`）機制完全相同。修法統一：`Object.prototype.hasOwnProperty.call(ADAPTERS, vendor)` 或先 `Set(ALLOWED).has()` 白名單。**建議與 ISO-ENUM-2 同批修**。

**SEC-LOGOUT-CSRF（P3）**：`functions/api/_middleware.ts:19` CT_EXEMPT_EXACT 含 `/api/auth/logout` → logout POST 不需 application/json（不觸 CORS preflight）；`logout.ts` handler 無 Origin/CSRF 檢查；`cookies.ts:15` SameSite=None → 跨站請求附帶 refresh cookie。⇒ 攻擊者頁 `fetch('https://chiyigo.com/api/auth/logout',{method:'POST',credentials:'include',body:'x'})`（simple request）即強制登出受害者（DoS/annoyance，不洩資料）。對照 refresh 因需 application/json 觸 preflight 被擋。修法：logout handler 加 Origin allowlist（inline `origin === 'https://chiyigo.com'`），或移除 CT 豁免改要求 application/json；同步複查 OAuth callback 豁免是否有等價 state-change CSRF 面。

---

## 4. 對抗式駁回（2 條 P2 候選 → refuted）

### 駁回 1：IdP authorize→code→token 鏈無 client_id 綁定（dd-oauth-oidc 報 P2 → refuted）

**結構觀察全部屬實**（authorize/auth_codes/token 全鏈無 client_id，RP 身分純由 redirect_uri 推導，四 RP 共用單一 AS），**但「cross-RP code injection 可觸發」不成立**。兩種攻擊形態皆被既有 control 完整擋住：(1) Attacker-as-RP 拿 victim code 換 token → code 綁 legit-client 的 code_challenge（S256 不可逆），攻擊者無法產生匹配 code_verifier → PKCE verify fail。PKCE 正是 OAuth 2.0 Security BCP 對 code injection 的標準 mitigation，功能等價 code-to-client binding。(2) Code 注入他 client callback → code 只送到 registry exact-match 驗過的 redirect_uri（四 RP distinct origin、無 namespace 重疊、僅 exact string match），且 aud=resolveAud(redirect_uri) + jwt per-aud 驗證讓跨 aud token 打不進。**找不到「加 client_id 能擋而 PKCE+exact-redirect+per-aud 擋不到」的請求序列。** finder 自己已重框為「RFC6749 §4.1.1 client_id REQUIRED 的縱深缺口」=規格符合，非可觸發 Tier-0。**降為 P3 spec-compliance 備忘**（接入未來 confidential 第三方 RP 時回填；四 RP 全 first-party 不存在此 trigger）。

### 駁回 2：bind-email 以 body.aud 簽 token → 跨 RP self-escalation（dd-oauth-oidc 報 P2 → refuted）

**核心事實主張錯誤**。finder 宣稱「bind-email 是此族唯一讓 caller 自選 aud 的缺口」，但 grep `audience` 全 functions/ 顯示「body.aud → resolveAud(aud) → signJwt({audience})」是**所有直接（非 redirect）登入端點的全站標準 pattern**，至少 5 個 sibling 端點完全相同：local/login.ts:44-45+236、register.ts:35-36+209、2fa/verify.ts:49-50+166、webauthn/login-verify.ts:63-64+223、step-up.ts:157+169。**無不變量違反**：token.ts/callback.ts 鎖 aud 是因為它們是 redirect/PKCE 流程（RP 由註冊 redirect_uri 釘住）；直接 POST 回 caller 的登入端點沒這約束——已認證使用者本就有資格為任何已註冊 RP aud 取 token（系統無 per-RP consent 表，RP worker 純靠 aud 比對信任 chiyigo 簽的 token）。同一使用者直接跑該 RP 自家 OAuth init 即可拿到一模一樣的 aud token，bind-email 沒給出正常流程拿不到的東西。**audience 隔離擋的是「跨 RP token 互打 resource API」（jwt 預設驗 chiyigo 達成），不是「使用者不得為自己取 RP token」。** 駁回，無 finding。

---

## 5. 修復計畫（窗內 P1/P2，Dual Gate）

依窗口擴編紅線：**P0–P2 窗內修**（Dual Gate，沿 ISO/EVT 前例）；P3 留 Opus 6/26 + 窗內寫 pre-fix-fail regression pack。

**建議實作順序**（先低風險暖身、後高張力）：

1. **SEC-CEREMONY-DOS（P2）+ SEC-ADMIN-ENUM（P2）+ SEC-KYC-ENUM-2（P3 順帶）** — 機械性補強（加 RateLimitKind + read-audit + cleanup task + 原型鏈守門），無設計爭議，first-do-no-harm 最小 diff。可一顆或兩顆 PR。
2. **SEC-RESET-2FA-BF（P1）** — 加 reset_2fa rate-limit kind + TOTP-fail audit + 失敗達上限作廢 token。沿既有 2fa convention，scope 清楚。
3. **SEC-FACTOR-ADD-A（P1，headline；3 端點）** — register-verify + wallet/verify + **oauth init is_binding** 改 requireStepUp（或 current_password）+ 一次性盤點既有 passkey/wallet/user_identities（防修補前已植入）。auth/step-up 熱區，**必送 Codex**。
   - **SEC-FACTOR-ADD-B（hardening，另 PR）** — factor reverification schema（assurance_level / created_session_id / requires_reverification）+ reset/bump 強制下線時標記非當前 session 因子。**非 P1 必要條件**（ADD-A 已封閉 live P1；ADD-B 為前向 hardening，含 schema 變更慢工另裁）。
   - **不採納** passkey-login 強制疊 TOTP（破壞 phishing-resistant 設計；UV passkey=合法 MFA，code 已標 amr）；登入端 non-UV 單因子殘留屬 P3 SEC-AMR-INCONSISTENT。
4. **SEC-REFRESH-REUSE（P1，需 owner 架構裁決）** — **不進實作前先請 owner 裁 tradeoff**：是否採 OAuth BCP（reuse→撤 family，接受 benign re-login 成本）並重新評估 Fork2 round-2 H 的反向保護。裁決前只寫 pre-fix-fail regression（含對稱保護回歸：device-mismatch-on-revoked NO family-revoke + grace_orphan benign 必須仍綠）。**必送 Codex + owner ruling**。

每顆走：feature branch → repro pre-fix RED → 實作 → gates 全綠（lint/typecheck/相關 test/build:functions/ratchet）→ 自審到零 → Codex Code Gate → squash-merge。**禁直推 main**（沿 6/12 push 政策）。

### 小校準 Gate 校正（雙 Gate ratified，2026-06-13；code 前必落 plan）

**P4 小校準 Gate ✅ 完成**：ChatGPT Architecture Gate + Codex Plan Gate 皆 **APPROVED WITH CORRECTIONS**。兩條 binding 校正：

- **PT-6（ADD-A 的 code 前置 BLOCKER，非 residual）**：`step-up.ts:108` 強制 `totp_enabled` + `change-password` 本身需 step-up（`change-password.ts:43`）→ 無 TOTP/純 OAuth 用戶無 elevation bootstrap。**Codex 裁決：reject first-factor-add 豁免**（否則被盜 token 仍能加第一把 rogue factor、P1 沒關）。ADD-A 必須**二選一寫死**：
  - **嚴格版**：no-TOTP/no-password 用戶先走 dashboard email reset 設密碼（`dashboard.ts:1022` / `forgot-password.ts:32`）→ 啟 TOTP/step-up → 才能 add factor。
  - **UX 版**：擴充 elevation primitive — local no-TOTP 可用 `current_password`；OAuth-only 須對**既綁 provider** 重新 OAuth reauth 後才 mint `elevated:account`。
  - **禁用「剛登入/access token still fresh」當 elevation**（=被盜 token 前提本身）。**↑ 待 owner 裁 strict vs UX。**
- **PT-2（SEC-REFRESH sub-path 明確拆，禁把 `reuse_detected` 當單一觸發 `refresh.ts:164`）**：
  - `successor_token_hash` NULL（logout/admin/device 已撤）→ **不** family-revoke、**不** critical theft audit、最多 warn/no-op 401（避免 false alarm）。
  - `grace_device_mismatch`（`refresh.ts:133`）→ **不** 撤（維持 round-2 H）。
  - proven benign grace orphan → **不** 撤。
  - **唯 rotation-revoked 且非 proven benign**（out-of-grace / device-null candidate / dead-missing successor）→ 才用**被呈現 token 的 `session_id` family** revoke + idempotent audit + abuse cap。
- **Observability（Codex）**：ADD-A 保留三路 factor-add audit；SEC-REFRESH 把 no-op replay / family-revoke / abuse-cap 命中拆成可查 reason code。
- **PT-5 確認**：3 路 factor-add（register-verify / wallet-verify / oauth init is_binding）窮舉；`oauth/bind-email` **非**第四條（temp_bind 一次性 token + email collision 拒絕）。
- **CODING 狀態**：P2 機械補強 + SEC-RESET-2FA-BF = **CODING_ALLOWED**；ADD-A / SEC-REFRESH = **NOT YET CODING_ALLOWED** until PT-6（owner strict/UX）+ PT-2 拆解落 plan。

---

## 6. 小校準 Gate 問題 + P3 backlog

### 給小校準 Gate（P4 報告完一次；owner 可比照 P3 裁決 A 併入末期完整 Gate）

1. **§1 心智模型校準表**：00 §2.2 token taxonomy 與 §2.3 雙 role 軸正交性的端點層理解是否有誤讀？（本輪所有 finding 皆判為「既有 pattern 覆蓋不一致」而非機制錯誤——此框架是否成立？）
2. **SEC-FACTOR-ADD severity**：「被盜 token → 永久接管」前置=step-up 自身威脅模型，定 P1（非 P0）是否同意？修法是否該含「強制下線時撤/標記非當前 session 因子」？
3. **SEC-REFRESH-REUSE tradeoff**：採 OAuth BCP（reuse→撤 family）是否值得重開 Fork2 round-2 H 擋的反向向量？或維持現狀並在設計文件明記「web token 無 reuse-family-revoke 是 round-2 H 的刻意取捨」？
4. **駁回 1（client_id）**：PKCE S256 + redirect_uri exact match + per-aud token 是否真等價 code-to-client binding（接受不加 client_id）？
5. **P3 分流**：下列 13 條 P3 是否全進 STAGE8 backlog（Opus 6/26），或有哪條該升窗內修？

### P3 backlog 清單（13 條，留 regression pack 給 Opus）

| ID | 一句話 | 來源 finder |
|---|---|---|
| SEC-KYC-ENUM-2 | resolveKycAdapter 原型鏈鍵 500（與 ISO-ENUM-2 同批） | mx-auth-core / mx-public-tenant |
| SEC-CRON-TIMING | 8 支 cron 非 timing-safe CRON_SECRET 比對 | mx-admin |
| SEC-LOGOUT-CSRF | logout CT 豁免 + 無 Origin → 強制登出 CSRF | mx-public-tenant |
| SEC-GETPROVIDER-PROTO | getProvider 物件索引原型鏈（目前不可達） | mx-auth-proto |
| SEC-AUTHCODE-NOAUDIT | oauth/code auth_code 鑄造無 rate-limit + 無 audit | mx-auth-proto / dd-oauth |
| SEC-REGISTER-FAILOPEN | register 唯一反濫用是 Turnstile，未設時 fail-open（旁及 P7） | mx-auth-core |
| SEC-MONEY-NORL | money refund/approve/delete/reject 無 per-user rate-limit（vs billing 有） | mx-admin |
| SEC-SCOPE-COARSEFINE | reject/delete 要 coarse、approve/refund 要 fine → finance 功能不對稱 | mx-admin |
| SEC-MODERATION-NOSTEPUP | ban/unban/revoke 無 step-up（與其他破壞性 admin 端點不一致；需裁決或明記豁免） | mx-admin |
| SEC-AI-RL-RACE | ai/assist 多維 rate-limit read-then-act 非原子（並發繞限額） | mx-public-tenant |
| SEC-REQ-NOAUDIT | 公開 requisition 表單無 audit + 無 Turnstile（僅 per-IP 3/day） | mx-public-tenant |
| SEC-MONEYUSER-NORL | refund-request/requisition revoke/delete 無 rate-limit | mx-public-tenant |
| SEC-2FA-ACTIVATE-NOBUMP | 啟用 2FA 不 bump token_version（不踢既有 session） | mx-public-tenant / dd-token |
| SEC-PWRESET-NONATOMIC | password 變更與 token_version bump 非原子（finder P2 → verifier 降 P3） | dd-token-lifecycle |
| SEC-2FAVERIFY-NOBANNED | 2fa/verify 簽 token 前無顯式 banned 檢查（requireAuth 兜底） | dd-strong-auth |
| SEC-AMR-INCONSISTENT | 2fa/verify 缺 amr claim（webauthn 有）；無端點以 amr 強制 MFA | dd-strong-auth |
| SEC-ENDSESSION-DBLWRITE | end-session cookie fallback 與 id_token_hint 雙路徑重複寫 + 重複 dispatch | dd-oauth-oidc |
| SEC-FRONTCHANNEL-FRAMESRC | frontchannel/end-session frame-src 靠 registry 動態值，rowToClient 未驗 *_uris 格式 | dd-oauth-oidc |
| SEC-SILENTSSO-NODEVICE | silent SSO 路徑不驗 device binding 也不發 audit | dd-oauth-oidc |

> 註：上表 16 條獨立項（部分跨 finder 重複者合併）。Opus regression pack 以各 finding 的 reproSketch 為基底，pre-fix RED / post-fix GREEN，`.skip` 標記進 repo。

---

## 7. 方法論與覆蓋完整性

- **finder 切角**：mx-auth-core（29 端點）/ mx-auth-proto（OAuth+webauthn+wallet 協議）/ mx-admin（39 admin 端點）/ mx-public-tenant（其餘 + KYC webhook 明確任務）+ dd-token-lifecycle / dd-oauth-oidc / dd-strong-auth。矩陣總計 104 row。
- **對抗式 verify**：每條 P0-P2 候選預設 refuted，verifier 親讀核對。2 條 P2 駁回成立（§4）；1 條 P2 降 P3（password-reset 非原子）；1 條 P2→P3 spec-compliance（client_id）。
- **主線補裁**：3 個 dd-strong-auth verifier 撞 session limit → 主線今日親自讀碼補驗（含 headline SEC-FACTOR P1），無覆蓋缺口。
- **紀律遵守**：inline 標 Codex rN 的已修項依 §6 紀律不重列（refresh Fork2/PKCE 驗章/email 碰撞雙閘門/temp_bind aud 鎖/jti atomic 等大量已驗項列入各 finder coverage 的「已驗證為正確、非 finding」段）。
- **已知 deferral 對齊**：PAY-002/ISO-ENUM-1/EVT-001..006 不重列；ISO-ENUM-2 的 sibling（kyc/[vendor]）為本輪明確任務、確認成立並入同批。

_P4 安全邊界審計完成於 2026-06-13。下一步：小校準 Gate（或併末期）→ /clear → P5 整合 + loop-until-dry 第二輪。_
