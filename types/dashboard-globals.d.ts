/**
 * Ambient declarations owned by src/js/dashboard.ts.
 *
 * Why this file exists:
 *   src/js/dashboard.ts is loaded as a classic <script src="/js/dashboard.js">
 *   on /dashboard.html. It stashes a render cache + profile flags on window so
 *   applyLangD() can repaint dynamic UI on language switch. Root tsconfig
 *   (moduleDetection:"force") treats dashboard.ts as a module → its
 *   script-scope `interface Window` augmentation is only visible inside that
 *   module → forward references inside dashboard.ts itself (e.g. callbacks
 *   reading window._lastRequisitions before later top-level decls) need this
 *   ambient. Prod build tsconfigs (types:[]) do not load this file;
 *   dashboard.ts inline augmentation services that path.
 *
 * Scope:
 *   dashboard.ts surface only (vendor injections QRCode / EIP-1193 ethereum
 *   live in types/globals.d.ts — those are not source-owned).
 *
 * Lifecycle:
 *   Stage 6.2 split from types/globals.d.ts.
 */

export {};

declare global {
  // PR-5w (Stage 5)：dashboard.ts 的 render cache + profile flags。簽章與
  // src/js/dashboard.ts 檔首的 `interface Window` 等價（dashboard.ts 服務 prod
  // tsconfig，types:[] 不載本檔；本宣告服務 root tsconfig 與其他 caller，兩條
  // type path 等價合併，per api.ts / notify.ts 同款慣例）。
  interface Window {
    _lastRequisitions?: Array<Record<string, unknown>>;
    _lastDevices?: Array<Record<string, unknown>>;
    _lastPasskeys?: Array<Record<string, unknown>>;
    _lastWallets?: Array<Record<string, unknown>>;
    _lastPayments?: Array<Record<string, unknown>>;
    __hasPassword?: boolean;
    __totpEnabled?: boolean;
    __userEmail?: string;
  }
}
