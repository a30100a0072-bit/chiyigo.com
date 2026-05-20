/**
 * Ambient declarations for chiyigo.com.
 *
 * Why this file exists:
 *   `public/js/api.js` is loaded via <script src="/js/api.js"> on every page and
 *   exposes `apiFetch` / `ApiError` / `formatApiError` etc. on `window`. Source
 *   modules in `src/js/**` reference these symbols as globals, so `tsc --checkJs`
 *   needs ambient declarations to recognize them.
 *
 * Scope:
 *   - browser globals only (do NOT add Workers / Pages Functions runtime here)
 *   - keep types loose (function shapes) — strict typing happens at point of use
 *     when individual files migrate to .ts
 *
 * Lifecycle:
 *   This file is part of the JS→TS migration scaffolding (Stage 0b). It will
 *   shrink as `public/js/api.js` itself migrates to a typed module that source
 *   files can `import` directly. Do not expand it; prefer narrowing usage sites.
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
  // Runtime：實際 class 仍由 src/js/api.ts IIFE-private 定義 + `window.ApiError = ApiError`
  //         掛到 window；browser 中 window === globalThis，bare `ApiError` 自然解析為
  //         window.ApiError。ambient `declare class` 與 IIFE-local class 不重複 identifier
  //         （IIFE 內 class 不出 closure），故無原 PR-58 commit-1 顧慮的 duplicate identifier。
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
