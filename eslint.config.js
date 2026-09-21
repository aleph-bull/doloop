// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.vite/**',
      'docs/parked/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: [
      'apps/portal/**/*.{ts,tsx}',
      'apps/extension/**/*.{ts,tsx}',
      'packages/ui/**/*.{ts,tsx}',
    ],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Files legitimately export hooks and helpers next to components.
      'react-refresh/only-export-components': 'off',
      // Resetting dialog state on open and adopting server state are intentional patterns here.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['apps/extension/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, chrome: 'readonly' },
    },
  },
  {
    // core is pure: no DOM, no Node I/O.
    files: ['packages/core/src/**/*.ts'],
    ignores: ['packages/core/src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'fetch', 'localStorage', 'process'],
      'no-restricted-imports': [
        'error',
        { patterns: ['react', 'react-*', 'node:*', 'fs', 'path', 'http', 'https', 'crypto'] },
      ],
    },
  },
);
