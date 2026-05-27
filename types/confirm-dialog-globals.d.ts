/**
 * Ambient declarations owned by src/js/confirm-dialog.ts.
 *
 * Why this file exists:
 *   src/js/confirm-dialog.ts is loaded as a classic
 *   <script src="/js/confirm-dialog.js"> via the head-foot partial on every
 *   page and attaches window.confirmDialog. Root tsconfig
 *   (moduleDetection:"force") treats confirm-dialog.ts as a module → its
 *   script-scope `interface Window { confirmDialog }` augmentation is only
 *   visible inside that module → cross-script callers need this ambient to
 *   type `window.confirmDialog(...)`. Prod build tsconfigs (types:[]) do not
 *   load this file; confirm-dialog.ts inline augmentation services that path.
 *
 *   The opts shape is inlined here (not referencing confirm-dialog.ts's
 *   ConfirmDialogOpts type) because moduleDetection:"force" makes that type
 *   module-local — we cannot cross-file reference it from a separate ambient.
 *
 * Scope:
 *   confirm-dialog.ts surface only.
 *
 * Lifecycle:
 *   Stage 6.2 split from types/globals.d.ts.
 */

export {};

declare global {
  interface Window {
    /** Confirm modal attached by src/js/confirm-dialog.ts. Signature must stay
     * byte-aligned with the script-scope `interface Window { confirmDialog }`
     * augmentation in confirm-dialog.ts (prod tsconfig 不載本檔). */
    confirmDialog: (opts?: {
      title?: string;
      message?: string;
      confirmText?: string;
      cancelText?: string;
      danger?: boolean;
    }) => Promise<boolean>;
  }
}
