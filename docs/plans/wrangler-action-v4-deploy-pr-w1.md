# PR-W1：wrangler-action v3 → v4（deploy-only；Node24 + pin wrangler 4.87.0）

> 狀態：**plan 階段**（本檔即 plan-gate 標的；0 行其他變更已 committed）。
> Base：main `dd60ee8`。動工分級：**infra / live-deploy 遷移 → FULL 四檢查點、不 auto-merge**（owner-ruled）。
> 背景 scan：`cloudflare/wrangler-action` v3↔v4 **input/output 介面 byte-identical**；唯一行為變更＝(a) node20→node24、(b) **未 pin `wranglerVersion` 時 default wrangler 3.x→4.x(latest)**。deploy.yml **無 `npm ci`** → action 裝自己的 wrangler（現行 3.x）。owner 裁 **A2（pin 4.87.0）+ B2（拆 deploy 先 / cleanup 後）**。

## scope（owner-ruled：deploy-only）
- **In**：`.github/workflows/deploy.yml`（1 處 wrangler-action）。
- **Out**：`cleanup.yml`（7 處 destructive `d1 execute --remote` DELETE）→ **PR-W2**（owner-dispatch 驗證、無 dry-run、不 auto-merge）。

## 1. 改動（恰 2 項）
1. `uses: cloudflare/wrangler-action@v3` → `@v4`。
2. `with:` 加 `wranglerVersion: "4.87.0"`（對齊 repo `package.json` `wrangler ^4.87.0` + ci.yml `build:functions`；deterministic、禁浮動 `latest`、修 deploy(3.x)/build(4.x) skew）。

## 2. 逐字不碰（byte-identical）
`apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}`、`accountId: 2d2c4b4d…`、`command: pages deploy public --project-name chiyigo-com --branch main --commit-hash ${{ github.sha }} --commit-message "deploy ${{ github.sha }}"`、checkout step、triggers（`push: [main]`）、permissions。**0 source / 0 baseline 變更。**

## 3. 為何安全 + 風險
- `wrangler pages deploy` 的 flags（`--project-name`/`--branch`/`--commit-hash`/`--commit-message`）在 wrangler 3→4 穩定；repo 已用 wrangler 4.87（ci.yml `build:functions` 綠）→ 4.87 CLI 對本 repo Pages 可用。
- **deploy.yml 只在 push main 跑** → 本 PR 的 PR-CI **不會跑 deploy**；驗證在 **merge 後**。
- **reversible-ish**：Pages 保留上一個成功 deployment；新 deploy 失敗不下線舊版。失敗則 revert 本 PR（回 @v3）重 deploy。

## 4. gates / validation
- **pre-merge**：PR CI（ci.yml `test`，source 未動 → 綠 sanity）；diff review 確認恰 2 項、command byte-identical；YAML 合法。
- **post-merge（核心）**：push main 觸發 deploy.yml → **驗 Pages deploy run success** + **deployment URL / 站台載入**（無痕）。run log 確認跑的是 **wrangler 4.87.0**。
- 失敗 SOP：revert PR-W1 → 回 @v3 重 deploy → 重新評估。

## merge path
FULL：plan→自審→Codex plan-gate→code→自審→Codex code-gate→**owner 明示同意**→`gh pr merge --squash --delete-branch`→**post-merge deploy 驗證**。**不 auto-merge**。
