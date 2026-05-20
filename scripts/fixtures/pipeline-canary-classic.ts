// PIPELINE_CANARY_CLASSIC — 不要刪。
// CI `scripts/verify-browser-pipeline.mjs` 用此檔驗證：
//   1. `tsconfig.browser-classic.json` (module:"none" + moduleDetection:"auto") 真能 emit 給 classic <script> 用
//   2. emit 結果不會被 TypeScript 插入 `export {};`（會讓 classic <script> 載入時 SyntaxError）
//   3. emit 結果含 marker "PIPELINE_CANARY_CLASSIC_OK"
//
// 紀律：本檔故意無 top-level import/export，模擬未來 src/js/login-boot.ts / notify.ts 等 classic 入口的形狀。
// 寫法用 (globalThis as unknown as {...}) 而非 declare const window，避免在 root tsconfig (isolatedModules:true + moduleDetection:force) 下增 errorCount。
;(globalThis as unknown as { __chiyigoPipelineCanaryClassic?: string })
  .__chiyigoPipelineCanaryClassic = 'PIPELINE_CANARY_CLASSIC_OK'
