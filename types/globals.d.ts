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
  // PR-58 (Stage 4.5b-3)：`ApiError` 的真實 class 宣告搬到 src/js/api.ts top-level
  // （script-mode 全域 class），避免 ambient `declare class` 與真實 class 重複
  // identifier。此處不再宣告；callers `e instanceof ApiError` 由 api.ts 全域 class 提供。

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

  /** Silent token refresh — returns true on success. */
  function silentRefresh(): Promise<boolean>;

  interface Window {
    apiFetch: typeof apiFetch;
    /** PR-58: ApiError class 由 src/js/api.ts top-level 宣告（script-mode 全域）；
     * 結構性 typed 避免依賴已搬走的 `declare class ApiError`。 */
    ApiError: new (payload: ApiErrorPayload) => Error & {
      status: number;
      traceId: string | null;
      code: string | null;
      body: unknown;
    };
    formatApiError: typeof formatApiError;
    tApiError: typeof tApiError;
    tApiErrorData: typeof tApiErrorData;
    silentRefresh: typeof silentRefresh;

    /** Latest X-Request-Id captured by apiFetch; for user error reports. */
    __lastTraceId?: string;

    /** Fallback storage for device UUID when localStorage is unavailable. */
    __chiyigoMemoryDeviceUuid?: string;

    /** API_ERROR_I18N dictionary attached at runtime. */
    __apiErrorI18n?: Record<string, Record<string, string>>;
  }
}
