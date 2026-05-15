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
  class ApiError extends Error {
    constructor(payload: ApiErrorPayload);
    status: number;
    traceId: string | null;
    code: string | null;
    body: unknown;
  }

  /** Wrapper around fetch — see public/js/api.js header for full contract. */
  function apiFetch<T = unknown>(
    url: string,
    opts?: RequestInit & { skipAuthRetry?: boolean },
  ): Promise<T>;

  /** Format an ApiError (or any thrown value) into a user-facing string. */
  function formatApiError(err: unknown, fallback?: string): string;

  /** i18n-aware ApiError formatter — returns localised message. */
  function tApiError(err: unknown, fallback?: string): string;

  /** Same as tApiError but returns { message, traceId } structured payload. */
  function tApiErrorData(err: unknown): { message: string; traceId: string | null };

  /** Silent token refresh — returns true on success. */
  function silentRefresh(): Promise<boolean>;

  interface Window {
    apiFetch: typeof apiFetch;
    ApiError: typeof ApiError;
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
