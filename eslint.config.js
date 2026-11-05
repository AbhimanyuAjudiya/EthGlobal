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
// React rules also cover the component library (pure React; no Next plugin there).
const reactFiles = [...webFiles, 'packages/ui/src/**/*.{ts,tsx}'];

// ── Dependency rules (INTERFACES §12, ARCHITECTURE §4) ──────────────────────────────────────────
const at = (name) => [`@ethglobal/${name}`, `@ethglobal/${name}/*`];
/** Nobody imports another package's src/ or dist/; package names and subpath exports only. */
const deepImports = {
  group: [
    '@ethglobal/*/src',
    '@ethglobal/*/src/*',
    '@ethglobal/*/dist',
    '@ethglobal/*/dist/*',
    '**/packages/*/src/**',
    '**/packages/*/dist/**',
    '../../*/src/**',
    '../../../*/src/**',
  ],
  message:
    'Import another package by its name and subpath exports, never its src/ or dist/ (INTERFACES §12).',
};
/** One zone: files may not import the listed workspace groups (type-only imports allowed where noted). */
const zone = (files, banned, message, { allowTypeImports = false } = {}) => ({
  files,
  rules: {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: [
          deepImports,
          ...(banned.length ? [{ group: banned, message, allowTypeImports }] : []),
        ],
      },
    ],
  },
});
const zones = [
  zone(['**/*.{ts,tsx}'], [], ''),
  zone(
    ['packages/{protocol,crypto,eip3009}/**/*.ts'],
    ['@ethglobal/*'],
    'protocol, crypto and eip3009 are leaves: third-party imports only.',
  ),
  zone(
    ['packages/adapters/**/*.ts'],
    [...at('octroi'), ...at('ui'), ...at('api'), ...at('agent'), ...at('web')],
    'adapters may import protocol, crypto and eip3009 only.',
  ),
  zone(
    ['packages/octroi/**/*.ts'],
    [
      '@ethglobal/adapters/live',
      '@ethglobal/adapters/live/*',
      ...at('ui'),
      ...at('api'),
      ...at('agent'),
      ...at('web'),
    ],
    'octroi may import protocol, crypto and adapters (ports only, never ./live).',
  ),
  zone(
    ['packages/ui/**/*.{ts,tsx}'],
    [
      ...at('adapters'),
      ...at('octroi'),
      ...at('crypto'),
      ...at('eip3009'),
      ...at('api'),
      ...at('agent'),
      ...at('web'),
      '@ethglobal/protocol',
      '@ethglobal/protocol/*',
      '!@ethglobal/protocol/units',
    ],
    'ui may import @ethglobal/protocol/units (and protocol types) only.',
    { allowTypeImports: true },
  ),
  zone(
    ['services/api/**/*.ts'],
    [...at('agent'), ...at('web'), ...at('ui')],
    'services never import each other, web or ui.',
  ),
  zone(
    ['services/agent/**/*.ts'],
    [...at('api'), ...at('web'), ...at('ui')],
    'services never import each other, web or ui.',
  ),
  zone(
    webFiles,
    [...at('adapters'), ...at('octroi'), ...at('api'), ...at('agent')],
    'apps/web may import protocol, crypto, eip3009, ui and contracts/abi only.',
  ),
];

/** Raw fetch only inside httpJson and the fixture transport (ARCHITECTURE §8 row 2). */
const bareFetch = {
  files: ['**/*.{ts,tsx}'],
  ignores: ['packages/protocol/src/http.ts', 'packages/adapters/src/testing/**'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.type='Identifier'][callee.name='fetch']",
        message:
          'Use httpJson (@ethglobal/protocol/http) or an injected fetch; bare fetch( is banned.',
      },
      {
        selector:
          "CallExpression[callee.object.name=/^(globalThis|window|self)$/][callee.property.name='fetch']",
        message:
          'Use httpJson (@ethglobal/protocol/http) or an injected fetch; global fetch is banned.',
      },
    ],
  },
};

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/.next/',
    '**/.next-*/',
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
      files: reactFiles,
      ...react.configs.flat.recommended,
      settings: { react: { version: '19.3' } },
      languageOptions: {
        ...react.configs.flat.recommended.languageOptions,
        globals: { ...globals.browser, ...globals.node },
      },
    },
    { files: reactFiles, ...react.configs.flat['jsx-runtime'] },
  ]),
  { files: reactFiles, ...reactHooks.configs.flat.recommended },
  { files: webFiles, ...nextPlugin.configs.recommended },
  { files: webFiles, ...nextPlugin.configs['core-web-vitals'] },
  {
    files: reactFiles,
    rules: {
      'react/prop-types': 'off',
      // Pages Router only; this app uses the App Router.
      '@next/next/no-html-link-for-pages': 'off',
      // Server Components and route files export non-component values by convention.
      'react/no-unknown-property': ['error', { ignore: ['data-hash', 'data-address'] }],
    },
  },

  ...zones,
  bareFetch,

  // Plain JS (this file, config files): no type information available.
  { files: ['**/*.{js,mjs,cjs}'], extends: [tseslint.configs.disableTypeChecked] },

  prettier,
]);
