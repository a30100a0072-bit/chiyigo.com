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
  // Vendored ES module served from /public — treat as opaque, no types.
  const mod: unknown;
  export default mod;
}
