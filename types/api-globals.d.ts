/**
 * Ambient declarations owned by src/js/api.ts.
 *
 * Why this file exists:
 *   src/js/api.ts is loaded as a classic <script src="/js/api.js"> on every
 *   page and exposes apiFetch / ApiError / formatApiError / tApiError /
 *   tApiErrorData on window. Source modules in src/js/** reference these
 *   symbols as bare globals (instanceof ApiError / apiFetch(...)), so the
 *   root tsconfig — which treats api.ts as a module under
 *   moduleDetection:"force" — needs these ambient declarations to recognise
 *   bare callers. Prod build tsconfigs (types:[]) do not load this file; the
 *   script-scope `interface Window` block inside api.ts services that path.
 *
 * Scope:
 *   api.ts surface only — do NOT add other source-owned ambients here. Other
 *   owners live in sibling types/<owner>-globals.d.ts (Stage 6.2 split).
 *
 * Lifecycle:
 *   Stage 6.2 split from types/globals.d.ts. Stage 8 RFC: once dashboard.ts /
 *   admin-*.ts consume api.ts via explicit import, this file shrinks toward
 *   removal.
 */

export {};

interface ApiErrorPayload {
  status: number;
  traceId?: string | null;
  code?: string | null;
  message?: string;
  body?: unknown;
}

declare global {
  // PR-58 r1 (Stage 4.5b-3，codex Reject fix)：恢復 bare global `declare class ApiError`。
  // Why：root tsconfig.json `moduleDetection: "force"` 把 src/js/api.ts 當 module，
  //      top-level `class ApiError` 不會註冊到全域 → dashboard.js 等 bare `instanceof ApiError`
  //      caller 失去 typing（codex r1 critical risk）。
  // Runtime：src/js/api.ts 將 ApiError class 放在 module top-level（不在 IIFE 內，且 IIFE 後
  //         以 `window.ApiError = ApiError` 對外掛載）。prod tsconfig 以 module:"none" 編譯
  //         emit 後是 classic <script> top-level class，瀏覽器 global namespace 自然可見；
  //         root tsconfig 以 moduleDetection:"force" 讓 api.ts 是 module → top-level class
  //         module-scoped 不污染全域 → 與本檔的 ambient `declare class ApiError` 不衝突。
  //         注意：因 emit 為 top-level class，重複載入同支 /js/api.js 會在 runtime 拋
  //         `SyntaxError: Identifier 'ApiError' has already been declared`；目前 built
  //         public pages 不重複 include /js/api.js，未來新增載入點要避免雙 include。
  class ApiError extends Error {
    constructor(payload: ApiErrorPayload);
    status: number;
    traceId: string | null;
    code: string | null;
    body: unknown;
  }

  /** Wrapper around fetch — see src/js/api.ts header for full contract. */
  function apiFetch<T = unknown>(
    url: string,
    opts?: RequestInit & { skipRefresh?: boolean },
  ): Promise<T>;

  /** Format an ApiError (or any thrown value) into a user-facing string. */
  function formatApiError(err: unknown, fallback?: string): string;

  /** i18n-aware ApiError formatter — returns localised message. */
  function tApiError(err: unknown, fallback?: string): string;

  /** 對 raw fetch（非 apiFetch）後拿到的 { error, code, ... } 物件做 code-based 在地化；
   * 跟 tApiError 同 mapping 但接 plain object 而非 ApiError instance（auth-ui.js 的
   * login/register/2fa 走 raw fetch 用這個）。回 string，與 tApiError 一致。 */
  function tApiErrorData(data: unknown, fallback?: string): string;

  // PR-58 commit-2 (H slice)：移除 bare global `declare function silentRefresh()`。
  // Runtime 上 silentRefresh 是由 src/js/api.ts IIFE 把 closure-private `_silentRefresh`
  // 掛到 `window.silentRefresh`；api.js 未 load 時 window.silentRefresh === undefined。
  // 沒有任何 caller 走 bare global `silentRefresh()`（全走 `window.silentRefresh` /
  // `win.silentRefresh`），因此移除 bare declaration 不破壞 typing。Window 屬性下方
  // 改 optional 反映 runtime 真相。

  interface Window {
    apiFetch: typeof apiFetch;
    ApiError: typeof ApiError;
    formatApiError: typeof formatApiError;
    tApiError: typeof tApiError;
    tApiErrorData: typeof tApiErrorData;
    /** PR-58 H slice：optional 反映 runtime 真相（api.js 未 load → undefined）；
     * caller 必走 `typeof window.silentRefresh === 'function'` narrow。 */
    silentRefresh?: () => Promise<boolean>;

    /** Latest X-Request-Id captured by apiFetch; for user error reports. */
    __lastTraceId?: string;

    /** Fallback storage for device UUID when localStorage is unavailable. */
    __chiyigoMemoryDeviceUuid?: string;

    /** API_ERROR_I18N dictionary attached at runtime. */
    __apiErrorI18n?: Record<string, Record<string, string>>;
  }
}
