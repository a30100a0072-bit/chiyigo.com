# JS→TS 漸進遷移 Playbook

本文件為 `functions/` 與 `tests/integration/` JS→TS 漸進遷移期間，**所有 rename PR 必須遵守的最小紀律**。內容對 codex review、未來貢獻者、及 reviewer 開放，不依賴外部 memory。

> 上層脈絡見 `IAM_PLATFORM_ROADMAP.md` 2026-05-16 條目；本文件聚焦「下一顆 rename PR 該怎麼寫」。

---

## 1. Rename PR commit description：R100 vs R098 精確度

git 的 `--find-renames --name-status` 會給每筆 rename 一個相似度分數：

| Status | 意義 |
|---|---|
| `R100` | 100% 相同，**內容完全不變**（pure rename） |
| `R098` / `R099` / ... | 有少量內容改動（git 算出的相似度） |

### 規則

1. **subject 不要用「R100 pure rename」字眼**，除非整個 PR 真的零內容改動。改用：「N .js -> .ts (rename + minimal inline TS)」即足夠精確。
2. **body 必須分項列出**：
   ```
   - R100 ×N: <path>, <path>      (pure rename)
   - R098 ×M: <path> (1 line inline TS: <reason>)
   ```
3. **PR 標題禁用「R100」字眼**，理由同 #1。
4. push 後若發現 description 不夠精確 → **不要 force-push amend**（main protected），改在下一顆 commit 或 memo 補上紀錄。

### Why

codex review 會跑 `git diff --find-renames --name-status` 比對你寫的描述。subject 寫「R100」但實際是 R098 → review summary 留 nit，每輪累積一次 cache-bust + push round 收尾，成本不低。

**教訓來源**：PR-34 codex r1 non-blocking nit（2026-05-19）。

---

## 2. importer literal 必省略副檔名

`.js`→`.ts` rename 時，**所有 importer 必須改成 extensionless**：

```ts
// ❌ 會掛掉
import { x } from '../../functions/api/foo.js'

// ✅
import { x } from '../../functions/api/foo'
```

理由：vitest-pool-workers 與 Pages Functions bundle **不做 magic resolution**；rename 後留著 `.js` 副檔名會 404。

### rename PR 必 audit 4 glob 點

| # | 位置 | 檢查 |
|---|---|---|
| 1 | `tsconfig*.json` `include` | 不可縮小（拒絕 .ts） |
| 2 | ESLint `files` glob | 同上 |
| 3 | `vitest.*.config.*` `exclude` | 不可寫死 single-ext |
| 4 | 自製 `scripts/lint-*.js` | 同上 |

**教訓來源**：Stage 1 rename 漏網 2/4，靠 commit `bbad593` 補救。

---

## 3. ratchet baseline 紀律

`scripts/typecheck-ratchet.mjs` 是 day-1 gate。每顆 rename PR 收尾前**必須**：

1. `npm run typecheck:ratchet` 看 `errorCount` / `cleanFiles` 兩個帳本量子
2. **rename-only PR**：兩個量子都不該變動（除非 inline TS 補洞剛好讓某檔變 clean）
3. **reduce-error PR**：收尾前跑 `npm run typecheck:baseline:update` 把降下來的 errorCount 鎖進 baseline
4. **嚴禁**：新增 `:any` / `as any` / JSDoc `{any}` / `@ts-expect-error` / `@ts-ignore` / 新 `.js` 檔（除 `public/js/**` 白名單）

### CI 環境特殊規則（r7 hardening，PR-34 後）

CI（`GITHUB_ACTIONS=true` 或 `CI=true`）若 `RATCHET_BASE_REF` 與 `GITHUB_BASE_REF` 都缺失 → script 直接 `exit 3`，不再 fallback `HEAD~1`。

CI workflow 必須在 `.github/workflows/ci.yml` 注入：
```yaml
env:
  RATCHET_BASE_REF: ${{ github.event.pull_request.base.sha || github.event.before }}
  GITHUB_BASE_REF: ${{ github.base_ref }}
```

本機 dev 不受影響（保留 `WARN` + fallback `HEAD~1`）。

---

## 4. 兩段式 commit：refactor + cache-bust

每個 rename PR 落地必須是**兩個獨立 commit**：

1. **refactor commit**：`git mv` + 必要 inline TS + test importer 修正
2. **build → cache-bust commit**：`npm run build` 重 build static HTML，把 `?v=` 同步到資產的 content-hash

### Why 拆兩段

> **2026-06-15 SUPERSEDED**：`?v=` 改為 **per-file content-hash**（`scripts/lib/asset-versioning.mjs`；舊「git HEAD short hash」規則作廢，詳見 `docs/asset-versioning.md`）。以下隨之調整：
> - `?v=` **只在資產內容（`public/js`、`public/css`）真的變動時才變** —— 純 backend rename 不動 frontend → **無 `?v=` 變動、無需 cache-bust commit**（不再「與是否動 frontend 無關」）。
> - 不再有「build 抓 commit 前 HEAD」的時序陷阱（content-hash 與 git HEAD 無關、squash 後不再 stale）。
> - 動到 frontend 資產時：跑 `npm run build`（內部 two-pass content-hash），`public/` 與 `src/` 一起 commit；CI `verify:browser-pipeline` 會驗 committed HTML `?v=` 與資產 content-hash 一致。
- cache-bust commit 仍必須**純 hash sync**：`git diff --cached` 過濾非 `?v=` 行應為 0；嚴禁挾帶 i18n / runtime drift

### Why 不用 subshell 算 hash（shell-context 注意）

**bash / git-bash**：
```bash
# ❌ 在 PowerShell 跑會留字面字串；在 bash 雙引號內才會展開
git commit -m "... $(git rev-parse HEAD)"

# ✅ 兩個 shell 都最穩妥的版本：先算好 hash 再 commit
hash=$(git rev-parse --short HEAD)
git commit -m "... $hash"
```

**PowerShell**：
```powershell
# PowerShell 的子表達式語法是 $(...) 但是放在 double-quoted string 內才會展開；
# 上面 git-bash 那行直接複製到 PowerShell 也會展開（不是字面字串）。
# 真正會留字面字串的情境是「shell escaping 不一致」，例如雙引號被 HEREDOC 包住、
# 或 git commit -m 走 -F /dev/stdin / @'...'@ here-string 時。

# ✅ 最穩妥：先算 hash 變數，subject 直接帶字串字面
$hash = git rev-parse --short HEAD
git commit -m "chore(cache-bust): hash sync — <prev> -> $hash (...)"
```

**最低風險寫法**（跨 shell 通用）：直接手寫 hash 字面，不依賴 shell 展開。每次 cache-bust commit 前先 `git rev-parse --short HEAD` 看一次，貼進 subject。

**教訓來源**：cache-bust commit subject 留下 `$(...)` 字面 string 的多次案例；codex r2 review 點名語境不精準（2026-05-19）。

---

## 5. 金流 / auth / audit / webhook 熱區：first-do-no-harm

PR 範圍碰到下列任一 glob → **同 PR 禁止「順手 tighten signature」「順手清 errors」**：

- `functions/api/admin/payments/**`
- `functions/api/payments/**`
- `functions/api/webhooks/**`
- `functions/payment-return/**`
- `functions/api/admin/audit/**`
- `functions/api/admin/cron/**`（含 archive / aggregate / cleanup）
- `functions/api/auth/**`（含 step-up / token rotation）
- `functions/utils/audit-*.ts` / `functions/utils/payments.ts` / `functions/utils/rate-limit.ts`

### 規則

1. 最小 diff，**0 行為變更**：只補 inline TS 讓 tsc compile，禁止 signature widening / contract tightening
2. commit body 列「**未動清單**」：state machine / atomic lock / idempotency / structured outcome / adapter contract / audit shape 等，讓 review focus 對齊到安全邊界而非 type-only 改動
3. signature tightening / contract drift 等 codex r1 flag 才動，**讓 reviewer 而不是 author 決定收緊範圍**
4. low nit 立刻單獨 `docs:` / `fix:` commit + cache-bust 收尾，不積到下個 PR
5. r2 confirm clean 才算 chain 收尾

**教訓來源**：Stage 2 PR-1/2/3 與 Stage 3 admin/payments / audit chain / webhooks PR 全鏈。

---

## 6. 動態路由 `[param]` rename 必驗 compiled bundle

`[id]` / `[vendor]` / `[client_id]` / `[provider]` 等動態路由檔 `.js`→`.ts` 後，**必須** `npm run build:functions` 並 grep compiled bundle 確認 `:param` 映射還在：

```bash
grep -E "routePath: \"/api/.*:id\"" .tmp-pages-functions-build/*.*
```

理由：wrangler bundle 對 `[param]` rename 不保證自動 handle；漏網 → prod 該 endpoint 404。

---

## 連結

- `IAM_PLATFORM_ROADMAP.md` — 整體 phase 進度
- `scripts/typecheck-ratchet.mjs` — ratchet gate 實作（含 r7 CI guard 註解）
- `.github/workflows/ci.yml` — CI ratchet 環境變數注入
