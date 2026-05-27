/**
 * Vendor-only ambient declarations.
 *
 * Why this file exists:
 *   Holds Window augmentations for third-party globals that are injected by
 *   external sources we do not own:
 *   - QRCode: CDN-loaded library (cdn.jsdelivr.net qrcode@1.5.0), used by
 *     dashboard.ts for TOTP QR rendering.
 *   - ethereum: EIP-1193 wallet provider (MetaMask et al.), injected by browser
 *     wallet extensions.
 *
 * Scope:
 *   Vendor-owned surface only. Source-owned ambients (api / notify /
 *   confirm-dialog / dashboard / auth-ui) live in sibling
 *   types/<owner>-globals.d.ts — Stage 6.2 split.
 *
 * Lifecycle:
 *   New vendor injections add here. New source-owned ambients should NOT come
 *   back into this file — add a new types/<owner>-globals.d.ts instead, and
 *   wire it into tsconfig.browser-typecheck.json include.
 */

export {};

declare global {
  interface Window {
    /** QRCode library injected via CDN <script src="https://cdn.jsdelivr.net/...">. */
    QRCode?: {
      toCanvas: (canvas: HTMLElement | null, text: string, opts?: Record<string, unknown>) => Promise<void>;
    };

    /** EIP-1193 wallet provider injected by browser wallet extensions. */
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}
