// ESLint configuration of VibeLight (npm run lint)
//
// The widget runs on the web engine of the TV, as old as Chromium 69 on Tizen 5.5, so its scripts
// are parsed as ES2017: newer syntax such as optional chaining fails the lint instead of breaking
// the app on older TVs. These scripts share their globals across files, so they are checked for
// likely bugs rather than for undeclared names. The tools and the tests run on Node.js.
import globals from 'globals';

const bugRules = {
  'no-cond-assign': ['error', 'except-parens'],
  'no-const-assign': 'error',
  'no-constant-binary-expression': 'error',
  'no-dupe-args': 'error',
  'no-dupe-else-if': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-func-assign': 'error',
  'no-loss-of-precision': 'error',
  'no-self-assign': 'error',
  'no-sparse-arrays': 'error',
  'no-unreachable': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
};

const strictRules = {
  ...bugRules,
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
};

export default [
  {
    ignores: [
      'build/**',
      'h264bitstream/**',
      'libgamestream/**',
      'moonlight-common-c/**',
      'node_modules/**',
      'opus/**',
      'playwright-report/**',
      'ports/**',
      'test-results/**',
      'wasm/static/js/*.min.js',
    ],
  },
  {
    // Scripts of the widget, loaded by index.html or by the background service
    files: ['wasm/**/*.js', 'res/**/*.js'],
    languageOptions: {
      ecmaVersion: 2017,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: bugRules,
  },
  {
    // Decision logic shared by the widget and the unit tests, which has no other dependencies
    files: ['wasm/platform/stats-core.js', 'wasm/platform/autotune-core.js', 'wasm/platform/gamemode-core.js'],
    languageOptions: {
      globals: { ...globals.browser, module: 'readonly' },
    },
    rules: strictRules,
  },
  {
    // Node.js script that synchronizes the locale files
    files: ['wasm/static/js/i18n-sync.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: strictRules,
  },
  {
    // Mocks of the TV and of the WebAssembly module, loaded only by the development harness
    files: ['tools/dev-harness/mocks/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: bugRules,
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: strictRules,
  },
  {
    // The callbacks of page.evaluate() run in the widget, with its globals
    files: ['tests/ui/**/*.mjs'],
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: strictRules,
  },
];
