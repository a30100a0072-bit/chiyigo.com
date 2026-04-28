# 方案 A 遷移計畫：HTML Partials + Build Step

> 將 9 個 HTML 共用的 sidebar / topbar / mobile overlay / footer 抽成 partials，build 時組裝回 `public/`。修一處全站同步。

---

## 已確認決策

| # | 決策 | 結論 |
|---|---|---|
| 1 | `public/*.html` 是否加 .gitignore | **加** |
| 2 | 開 preview 分支驗證階段 1 | **OK** |
| 3 | Build 引擎 | **Handlebars**（裝 dev dependency） |
| 4 | 需要 `npm run build:watch` | **要** |
| 5 | 遷移節奏 | **每階段做完先 review 再下一階段** |

---

## 工具安裝（執行階段 0 時跑）

```bash
npm install --save-dev handlebars chokidar
```

- `handlebars`：partial 引擎，提供 `{{var}}`、`{{#if}}`、`{{#eq}}` 等語法
- `chokidar`：watch 模式檔案監聽（比 `fs.watch` 跨平台穩定）

---

## 目標範圍

**做**：抽 sidebar / topbar / mobile overlay / footer / `<head>` 共用區塊
**不做**：不改會員系統、auth API、JS 邏輯、CSS variables、theme 切換、i18n 機制、頁面內容區

---

## 目錄結構

```
chiyigo.com/
├── src/                          ← 新增：原始 HTML 來源
│   ├── pages/                    ← 每頁主檔（從 public/*.html 遷移）
│   │   ├── index.html
│   │   ├── about.html
│   │   ├── portfolio.html
│   │   ├── login.html
│   │   ├── dashboard.html
│   │   ├── ai-assistant.html
│   │   ├── requisition.html
│   │   ├── admin-requisitions.html
│   │   ├── privacy.html
│   │   ├── verify-email.html
│   │   ├── reset-password.html
│   │   ├── forgot-password.html
│   │   ├── bind-email.html
│   │   ├── confirm-delete.html
│   │   └── 404.html
│   └── partials/                 ← 共用片段
│       ├── sidebar-public.hbs
│       ├── sidebar-member.hbs
│       ├── sidebar-login.hbs
│       ├── topbar-mobile.hbs
│       ├── footer-contact.hbs
│       └── head-common.hbs
├── scripts/
│   └── build-partials.js         ← 新增：build script（Handlebars）
├── public/                       ← Build 產物
│   ├── *.html                    ← .gitignore，不再手改
│   ├── images/                   ← 靜態資產原地保留
│   ├── js/
│   ├── _headers / _redirects / robots.txt / sitemap.xml
├── package.json                  ← 加 build / build:watch script
├── .gitignore                    ← 加 public/*.html
└── MIGRATION_PLAN.md             ← 本檔
```

---

## Partial 變體分類

| Partial | 使用頁面 | 變數 |
|---|---|---|
| `sidebar-public` | index, about, portfolio, requisition, privacy, ai-assistant | `active` |
| `sidebar-member` | dashboard, admin-requisitions | `active` |
| `sidebar-login` | login | （無） |
| 無 sidebar | 404, verify-email, reset-password, forgot-password, bind-email, confirm-delete | — |
| `topbar-mobile` | 所有有 sidebar 的頁面 | `variant`, `active` |
| `footer-contact` | 9 個對外頁面 | （無） |
| `head-common` | 全部 | `title`, `desc` 等 meta |

**用法範例**：
```html
{{> sidebar-public active="portfolio"}}
{{> topbar-mobile variant="public" active="portfolio"}}
{{> footer-contact}}
```

Handlebars `{{#if (eq active "portfolio")}}active{{/if}}` 用來標 active 高亮。`eq` helper 在 build script 註冊。

---

## Build Script 規格（`scripts/build-partials.js`）

**功能**
1. 註冊所有 `src/partials/*.hbs` 為 Handlebars partial
2. 註冊 helper：`eq`（相等比較）
3. 掃 `src/pages/*.html`，編譯後輸出到 `public/同名.html`
4. `--watch` 模式：用 chokidar 監聽 `src/`，變更時重 build 對應頁面（partial 變更 → rebuild 全部）

**指令**
- `npm run build` → 一次性 build
- `npm run build:watch` → 開發用 watch

---

## Cloudflare Pages 設定變更

| 設定 | 現況 | 變更為 |
|---|---|---|
| Build command | （空） | `npm run build` |
| Build output directory | `public` | `public`（不變） |
| Root directory | （預設） | （不變） |
| Node version | （預設） | 確認 ≥ 18 |

---

## 遷移階段（每階段獨立 commit、獨立部署、可 rollback）

### 階段 0：基礎建設（不改任何頁面）
1. `npm install --save-dev handlebars chokidar`
2. 建 `src/pages/`、`src/partials/`、`scripts/` 目錄
3. 寫 `scripts/build-partials.js`
4. 在 `package.json` 加 `build` / `build:watch` script
5. 本地跑 `npm run build`（無檔案，預期不炸）
6. **Commit、不 push**（避免觸發 Cloudflare 用空產物部署）

### 階段 1：複製現有 HTML 到 src/，build 產出原樣
1. `cp public/*.html src/pages/`
2. `npm run build` → `public/*.html` 應跟原本完全一樣
3. 用 `diff` 確認無變化
4. **開 `feature/partials` 分支**，把 Cloudflare Pages preview 改到此分支驗證
5. 改 Cloudflare Pages 設定：build command = `npm run build`
6. `.gitignore` 加 `public/*.html`，`git rm --cached public/*.html`
7. Push `feature/partials`，**驗證 preview deployment 跟原站一樣**
8. 通過後 merge main

### 階段 2：抽 footer-contact（最低風險）
1. 建 `src/partials/footer-contact.hbs`，內容從 `index.html` 複製
2. 9 個 `src/pages/*.html` 替換成 `{{> footer-contact}}`
3. `npm run build`，diff 產物 vs 階段 1 基準
4. 視覺檢查 9 頁 footer
5. **Commit + push**，等 review

### 階段 3：抽 topbar-mobile
1. 建 partial，支援 `variant` (`public`/`member`/`login`) 與 `active`
2. 套用到所有有 mobile topbar 的頁面
3. build、diff、視覺檢查（特別檢查地球儀/光暗鍵順序、行動選單動作）
4. **Commit + push**，等 review

### 階段 4：抽 sidebar-public
1. 建 partial，支援 `active`
2. 套用到 index, about, portfolio, requisition, privacy, ai-assistant
3. build、diff、視覺檢查（active 高亮、登入連結指向）
4. **Commit + push**，等 review

### 階段 5：抽 sidebar-member
1. 建 partial（含「會員功能」分區、登出按鈕、user email 區塊）
2. 套用到 dashboard, admin-requisitions
3. build、diff、視覺檢查
4. **Commit + push**，等 review

### 階段 6：抽 sidebar-login + head-common
1. login 頁專用 sidebar
2. `<head>` 共用 meta / fonts / theme bootstrap / cf beacon
3. build、diff、視覺檢查
4. **Commit + push**，等 review

### 階段 7：清理與文件
1. 寫 `src/partials/README.md` 說明每個 partial 變數
2. 更新 `CLAUDE.md` 與 memory：未來改共用區塊改 `src/partials/`
3. 確認 `npm run build:watch` 開發體驗
4. **Commit + push**

---

## 風險與緩解

| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| Cloudflare build 設定錯 → 全站空白 | 中 | 高 | 階段 1 在 preview branch 驗證，保留回退步驟 |
| `@include` 變數差異漏處理 → active 高亮錯 | 中 | 低 | 每階段視覺檢查 9 頁 |
| Build script bug → 產物壞 | 中 | 中 | 階段 1 先驗證「空 include 也能跑出原樣」 |
| 本地忘了 watch → 改 partial 沒生效 | 中 | 低 | README 標示，考慮 pre-commit hook |
| 9 頁 sidebar 差異沒歸類完 | 中 | 中 | 開工前先 diff 9 頁 sidebar，列出差異後再決定變體切分 |
| .gitignore 後 clone 看不到產物 | 低 | 低 | README 說明先 `npm run build` |

---

## 預估時間

| 階段 | 時間 |
|---|---|
| 0. 基礎建設 + build script | 1~2 小時 |
| 1. 複製到 src/、配 Cloudflare | 1 小時（含 preview 驗證） |
| 2. footer-contact | 30 分 |
| 3. topbar-mobile | 1.5 小時 |
| 4. sidebar-public | 1.5 小時 |
| 5. sidebar-member | 1 小時 |
| 6. sidebar-login + head-common | 1 小時 |
| 7. 清理文件 | 30 分 |
| **總計** | **約 8~10 小時，分次執行** |

---

## 執行順序紀錄

- [ ] 階段 0：基礎建設
- [ ] 階段 1：複製到 src/、配 Cloudflare
- [ ] 階段 2：抽 footer-contact
- [ ] 階段 3：抽 topbar-mobile
- [ ] 階段 4：抽 sidebar-public
- [ ] 階段 5：抽 sidebar-member
- [ ] 階段 6：抽 sidebar-login + head-common
- [ ] 階段 7：清理文件

每階段完成後在此清單打勾，並附 commit hash。
