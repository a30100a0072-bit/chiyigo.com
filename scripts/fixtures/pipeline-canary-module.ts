// PIPELINE_CANARY_MODULE — 不要刪。
// CI `scripts/verify-browser-pipeline.mjs` 用此檔驗證：
//   1. `tsconfig.browser-module.json` (module:"ESNext") 真能 emit ES module 給 <script type="module"> 用
//   2. emit 結果含 export（module 形狀）
//   3. emit 結果含 marker "PIPELINE_CANARY_MODULE_OK"
//
// 紀律：本檔有 top-level export，模擬未來 src/js/erp-architecture-3d.ts 等 ES module 入口的形狀。
export const PIPELINE_CANARY_MODULE = 'PIPELINE_CANARY_MODULE_OK'
