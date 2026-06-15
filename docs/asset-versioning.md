# Asset Versioning & Deploy Model

> 權威來源：`scripts/lib/asset-versioning.mjs`（SSOT helper）、`scripts/build-partials.js`（注入）、
> `scripts/verify-browser-pipeline.mjs`（CI guard）、`.github/workflows/deploy.yml`（部署）。
> 設計依據：`docs/plans/asset-versioning-hardening-plan.md`。

## 1. Cache-bust `?v=` 規則（現行）

本地資產（`<script src>` / `<link href>` 指向 `/js/*.js`、`/css/*.css`）的 `?v=` = **該資產內容的
content-hash**（sha256、前 12 hex、對 **LF-normalized bytes** 計算）。

- **per-file**：每個資產各自 hash，只有內容變動的資產 `?v=` 才變。
- **LF-normalized**（byte 層 `CRLF→LF`，不刪孤立 CR）：本機(Windows 可能 CRLF) / CI(Linux LF) /
  部署(git LF blob) 三方 hash 必然一致。
- **fail-closed**：被引用的本地資產缺檔、路徑逃逸、不支援的 root（v1 僅 `/js/*.js`、`/css/*.css`，
  **`.mjs` 未啟用**）、或帶非 `v=` 的 query → build / CI 直接報錯，不靜默放行。
- 外部資產（`https://…`、protocol-relative `//…`）不加 `?v=`。

## 2. Two-pass build graph（為何 tailwind.css 特殊）

`tailwind.config.cjs` 的 content globs 掃 **`./public/**/*.html` + `./public/js/**/*.js`**（生成後的
產物），所以 `tailwind.css` 必須在頁面 render **之後**才能產（否則掃到舊 HTML、漏 class）。但 HTML 的
`tailwind.css?v=` 又需要 tailwind.css 的 hash → 循環。解法（`build-partials.js:buildAll`）：

1. `buildJs` → `public/js`
2. `buildCss`（複製 `src/css` → `public/css`，排除 tailwind.css）
3. **PASS-1** render 頁面：注入 js + 非-tailwind css 的 content-hash；`tailwind.css?v=` 留 sentinel
4. `ensureTailwind`：以本地 Tailwind CLI 掃 PASS-1 的 public HTML/JS → 產最終 `public/css/tailwind.css`
5. **PASS-2** targeted patch：只把 `tailwind.css?v=<sentinel>` 換成真實 content-hash（reverse-check
   保證除此 token 外不動任何 HTML），不重 render、不造成 i18n/template drift。

> `npm run build` 內 `build:partials` 已 orchestrate tailwind；**canonical build 在 HTML 之後不可再跑
> 第二次 `build:css`**（會回到「hash 後仍可重寫資產」）。`build:css` script 仍保留為獨立手動工具。

## 3. 部署模型（repo-verifiable）

本 repo 的 GitHub 部署路徑是 **Direct Upload committed `public/`**：

```
# .github/workflows/deploy.yml（push main 觸發）
wrangler pages deploy public --project-name chiyigo-com --branch main --commit-hash <github.sha>
```

- 部署上傳的是 **committed `public/`**（git LF blob）；deploy 時**不跑 build**。
- `?v=` 在**開發者本機 `npm run build` 當下**烘焙進 committed HTML。
- `--commit-hash <github.sha>` 只是 Cloudflare 記的 deployment metadata，**不影響、也碰不到** committed
  HTML 的 `?v=`。
- **`CF_PAGES_COMMIT_SHA` 不適用**（那是 Cloudflare Pages Git-integration build 環境變數；本 repo 走
  wrangler Direct Upload，無 deploy-time build）。

> **Cloudflare dashboard 的 Build command**：owner 已於 2026-06-15 在 Cloudflare dashboard（Workers &
> Pages → chiyigo-com → Settings → Pages configuration → Build）親自確認 **Git repository 未連接**
> （顯示「Connect」）→ Git Integration build inactive、**Build command N/A** → production 確為 **Direct
> Upload committed `public/`**。狀態：**owner-confirmed**（未修改任何 dashboard 設定）。本變更亦 **不修改**
> dashboard 設定或任何跨帳號部署設定。
> 其他 repo 是否共用本 `build-partials`：無 npm package / submodule / shared-script consumer 證據 →
> **not repo-verifiable; owner states no shared repo consumer**。

## 4. SUPERSEDED（舊規則，勿復活）

- ~~`?v=` = `git rev-parse --short=8 HEAD`（全站單一 git HEAD short hash）~~
- ~~`BUILD_VER` env override 鎖 hash~~
- ~~timestamp fallback~~
- ~~「`?v=` = parent commit short8」/「`?v=` 必須等於 HEAD」~~

作廢原因：git-HEAD 方案在 **squash-merge** 後 orphan（feature-branch hash 落進 committed HTML，squash
產生新 HEAD），且改資產卻沒 rebuild HTML 時無 CI guard（造成 #89 修的 split-brain）。content-hash 與 git
HEAD 完全解耦、squash-independent。歷史審計（如 `docs/reviews/audit-js-to-ts-stage1-6-*.md` 的 D-4
`?v==parent short8` 驗證）為當時事實，**不改寫**、僅在此標 superseded。

## 5. CI guard 與 dev flow

- **CI guard**：`verify:browser-pipeline`（在 `ci.yml`）讀 **committed tree**（不 build），驗每個
  `public/*.html` 的 `?v=` 等於對應 committed 資產的 content-hash；stale / 缺檔 / 路徑逃逸 / 不支援 query →
  fail。攔住「改資產卻忘記 rebuild HTML」與 split-brain。
- **dev flow**：改 `src/` → `npm run build` → **`src/` 與 `public/` 一起 commit**（Direct Upload 部署
  committed `public/`，故產物必須進 repo）。純 backend 改動不動 frontend → 無 `?v=` 變動、無需 cache-bust
  commit。
