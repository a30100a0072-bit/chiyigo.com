/**
 * Vite-style raw imports used by the integration test setup.
 *
 * `tests/integration/_helpers.js` and the migrations test load `.sql` fixtures
 * via `import sql from './foo.sql?raw'`. The `?raw` suffix is interpreted by
 * the @cloudflare/vitest-pool-workers bundler (workerd) and returns the file
 * contents as a string. TypeScript needs an ambient module declaration so the
 * import resolves.
 *
 * Same pattern for vendored ES modules served as static assets under /js/.
 */

declare module '*.sql?raw' {
  const content: string;
  export default content;
}

declare module '*.html?raw' {
  const content: string;
  export default content;
}

declare module '/js/vendor/*.module.min.js' {
  // Catch-all for self-hosted vendor ES modules with no dedicated shim.
  // Three.js (`three.module.min.js`) has its own typed shim in types/three.d.ts
  // using a more-specific wildcard pattern (`/js/vendor/three.module.min*`),
  // which TypeScript prefers over this catch-all via longest-prefix matching.
  // New vendor modules: add a typed shim in types/<lib>.d.ts rather than rely
  // on this opaque fallback.
  const mod: unknown;
  export default mod;
}
