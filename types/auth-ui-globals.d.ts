/**
 * Ambient declarations owned by src/js/auth-ui.ts.
 *
 * Why this file exists:
 *   src/js/auth-ui.ts is a classic <script src="/js/auth-ui.js"> that —
 *   uniquely among Stage 5 entries — is intentionally NOT IIFE-wrapped (see
 *   auth-ui.ts header, PR-5u exception). It declares `const TAB_CONFIG = {...}`
 *   at script-global so consumers (login.ts) can bare-lookup via
 *   `typeof TAB_CONFIG !== 'undefined'`. Root tsconfig
 *   (moduleDetection:"force") treats auth-ui.ts as a module → that const is
 *   module-local → bare consumers fail typing without this ambient. Prod build
 *   tsconfigs (types:[] + module:"none") see auth-ui.ts as a classic script →
 *   the script-global const is directly visible, no ambient needed.
 *
 * Scope:
 *   auth-ui.ts cross-script global surface only.
 *
 * Lifecycle:
 *   Stage 6.2 split from types/globals.d.ts.
 */

export {};

declare global {
  /**
   * TAB_CONFIG — auth-ui.ts 內 top-level `const TAB_CONFIG = {...}` 提供（classic
   * <script> 同 Realm 共享 lexical scope）。login.ts 等其它 classic-page 走 bare
   * lookup `typeof TAB_CONFIG !== 'undefined'` 讀取。本宣告只為 root tsconfig
   * (moduleDetection:"force" 把 src/js/*.ts 當 module → 看不到 auth-ui.ts 的
   * module-local const) 補型別洞；prod tsconfig (types:[] 不載本檔 + module:"none"
   * 把 src/js/*.ts 當 classic script → 直接看見 auth-ui.ts 的 script-global const)
   * 不需此宣告。Stage 5 PR-5u 衍生；Stage 6.2 自 globals.d.ts 拆出。
   */
  const TAB_CONFIG: Record<string, { title: string; subtitle: string; showTabs: boolean }> | undefined;
}
