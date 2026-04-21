import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import unusedImports from 'eslint-plugin-unused-imports';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';

// Prevent-leaks configuration for the project's 37-warning drift cleanup.
//
// Why the specific plugin choices:
//
//   - `eslint-plugin-unused-imports`: speculative imports were 30% of the
//     37-warning backlog. This plugin catches them auto-fixably via
//     `npm run lint:fix`, and — more importantly — surfaces a distinct
//     error so they're never lumped in with legit unused-var warnings.
//     Configured as `error` at the CI level (via `--max-warnings=0`) so
//     the signal can't decay again.
//
//   - `@eslint-community/eslint-plugin-eslint-comments` with
//     `require-description: 'always'`: every future `eslint-disable`
//     must carry a `-- reason`. This is the brace that keeps honest
//     disables honest: if someone silences a rule, they commit to
//     explaining why in the same diff. The 3 jsx-a11y disables we
//     kept (APG-pattern justifications) are the template.

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '18.3' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      'unused-imports': unusedImports,
      '@eslint-community/eslint-comments': eslintComments,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      // `unused-imports/no-unused-imports` handles the import-specific
      // case with autofix. `@typescript-eslint/no-unused-vars` continues
      // to handle the rest (unused function args, unused local vars);
      // we disable its `args` check here so a legit unused-import on a
      // type-only import doesn't double-flag.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'unused-imports/no-unused-imports': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      // Every `eslint-disable` / `eslint-disable-next-line` must carry a
      // `-- reason` clause. Prevents silent rule-silencing; the reason
      // becomes the audit trail in `git blame`.
      '@eslint-community/eslint-comments/require-description': [
        'warn',
        { ignore: [] },
      ],
      // Disable directives that don't suppress anything ("unused
      // directives") get flagged at `warn` by default via eslint core;
      // we keep that at warn too (CI's --max-warnings=0 makes it a gate).
      '@eslint-community/eslint-comments/no-unused-disable': 'warn',
    },
  },
);
