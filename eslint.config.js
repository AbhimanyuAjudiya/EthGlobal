// @ts-check
import { fixupConfigRules } from '@eslint/compat';
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import importX from 'eslint-plugin-import-x';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const webFiles = ['apps/web/**/*.{ts,tsx}'];

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/.next/',
    '**/out/',
    '**/coverage/',
    'report/',
    'packages/contracts/',
    'apps/web/next-env.d.ts',
    'research/',
    'docs/',
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    rules: {
      // Interface methods are async by contract even when a mock has nothing to await.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },

  {
    plugins: { 'import-x': importX },
    rules: {
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
      'import-x/no-self-import': 'error',
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'type'],
          pathGroups: [
            { pattern: '@ethglobal/**', group: 'internal', position: 'before' },
            { pattern: '@/**', group: 'internal' },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },

  // Next.js app: React, hooks (incl. React Compiler rules) and the Next plugin, browser globals.
  // eslint-plugin-react 7.37 still calls context methods ESLint 10 removed; @eslint/compat shims them.
  ...fixupConfigRules([
    {
      files: webFiles,
      ...react.configs.flat.recommended,
      settings: { react: { version: 'detect' } },
      languageOptions: {
        ...react.configs.flat.recommended.languageOptions,
        globals: { ...globals.browser, ...globals.node },
      },
    },
    { files: webFiles, ...react.configs.flat['jsx-runtime'] },
  ]),
  { files: webFiles, ...reactHooks.configs.flat.recommended },
  { files: webFiles, ...nextPlugin.configs.recommended },
  { files: webFiles, ...nextPlugin.configs['core-web-vitals'] },
  {
    files: webFiles,
    rules: {
      'react/prop-types': 'off',
      // Pages Router only; this app uses the App Router.
      '@next/next/no-html-link-for-pages': 'off',
      // Server Components and route files export non-component values by convention.
      'react/no-unknown-property': ['error', { ignore: ['data-hash', 'data-address'] }],
    },
  },

  // Plain JS (this file, config files): no type information available.
  { files: ['**/*.{js,mjs,cjs}'], extends: [tseslint.configs.disableTypeChecked] },

  prettier,
]);
