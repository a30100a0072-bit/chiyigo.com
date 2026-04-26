import globals from 'globals'

const browserGlobals = {
  ...globals.browser,
  // App-defined globals on window (auth-ui.js, dashboard, etc.)
  authShowMsg: 'readonly',
  authClearMsg: 'readonly',
  tailwind: 'readonly',
}

export default [
  {
    ignores: [
      'node_modules/**',
      '.wrangler/**',
      'public/**',
      'database/**',
      'migrations/**',
      'scripts/**',
    ],
  },

  // Cloudflare Pages Functions (server) — Workers runtime, ES modules
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.serviceworker,
        crypto: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
    },
  },

  // Vitest unit tests
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
]
