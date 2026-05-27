/**
 * Ambient declarations owned by src/js/notify.ts.
 *
 * Why this file exists:
 *   src/js/notify.ts is loaded as a classic <script src="/js/notify.js"> via
 *   the head-foot partial on every page and attaches the toast API to
 *   window.notify. Root tsconfig (moduleDetection:"force") treats notify.ts as
 *   a module → its script-scope `interface Window { notify }` augmentation is
 *   only visible inside that module → cross-script callers (dashboard.ts /
 *   admin-*.ts etc.) need this ambient to type `window.notify.success(...)`.
 *   Prod build tsconfigs (types:[]) do not load this file; notify.ts inline
 *   augmentation services that path.
 *
 *   The shape is inlined here (not referencing notify.ts's NotifyApi type
 *   alias) because moduleDetection:"force" makes NotifyApi module-local —
 *   we cannot cross-file reference it from a separate ambient.
 *
 * Scope:
 *   notify.ts surface only.
 *
 * Lifecycle:
 *   Stage 6.2 split from types/globals.d.ts.
 */

export {};

declare global {
  interface Window {
    /** Toast system attached by src/js/notify.ts. Signature must stay byte-aligned
     * with the script-scope `interface Window { notify }` augmentation in notify.ts
     * (prod tsconfig 不載本檔). */
    notify: {
      success: (msg: unknown, opts?: { duration?: number }) => () => void;
      error: (msg: unknown, opts?: { duration?: number }) => () => void;
      warning: (msg: unknown, opts?: { duration?: number }) => () => void;
      info: (msg: unknown, opts?: { duration?: number }) => () => void;
    };
  }
}
