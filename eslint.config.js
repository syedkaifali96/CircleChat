// ESLint flat config for the CircleChat monorepo (root runs `npm run lint`).
// Kept deliberately small for M0: TypeScript-aware recommended rules, no `any`.
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.expo/**',
      '**/.expo-shared/**',
      '**/drizzle/**',
      // Tooling config files are CommonJS by design (expo/babel/jest/metro conventions).
      '**/*.config.js',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Manual-verification scripts run under plain Node (ESM), not the TS
    // compiler: Node runtime globals are expected there.
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    rules: {
      // AGENTS.md: no `any` unless genuinely unavoidable.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
