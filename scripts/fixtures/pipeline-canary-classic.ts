// PIPELINE_CANARY_CLASSIC — 不要刪。
// CI `scripts/verify-browser-pipeline.mjs` 用此檔驗證：
//   1. `tsconfig.browser-classic.json` (module:"none" + moduleDetection:"auto") 真能 emit 給 classic <script> 用
//   2. emit 結果不會被 TypeScript 插入 `export {};`（會讓 classic <script> 載入時 SyntaxError）
//   3. emit 結果含 marker "PIPELINE_CANARY_CLASSIC_OK"
//   4. Stage 5 prep (2026-05-21)：emit 內含一個 i18n sentinel const（見下方
//      PIPELINE_CANARY_I18N_DICT 行），verify 跑 injectI18n 後該 sentinel 必被替換為
//      src/i18n/pipeline-canary-classic.json 字典，字典 marker "PIPELINE_CANARY_I18N_OK"
//      必進到 post-inject 結果（residual sentinel 偵測同步必須 0 命中）。
//
// 紀律：本檔故意無 top-level import/export，模擬未來 src/js/login-boot.ts / notify.ts 等 classic 入口的形狀。
// 寫法用 (globalThis as unknown as {...}) 而非 declare const window，避免在 root tsconfig (isolatedModules:true + moduleDetection:force) 下增 errorCount。
//
// codex Stage 5 prep r1 拍板：sentinel 行保持可替換（不加 type assertion 或變數型別），
// 否則 I18N_SENTINEL regex 抓不到；type assertion 另起一行。
;(globalThis as unknown as { __chiyigoPipelineCanaryClassic?: string })
  .__chiyigoPipelineCanaryClassic = 'PIPELINE_CANARY_CLASSIC_OK'

const PIPELINE_CANARY_I18N_DICT = /*@i18n:pipeline-canary-classic@*/{}
const PIPELINE_CANARY_I18N = PIPELINE_CANARY_I18N_DICT as { i18nMarker?: string }

;(globalThis as unknown as { __chiyigoPipelineCanaryI18nMarker?: string })
  .__chiyigoPipelineCanaryI18nMarker = PIPELINE_CANARY_I18N.i18nMarker || ''
