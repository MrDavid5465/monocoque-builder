import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'src-tauri', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Pragmatic severities for a large, previously-unlinted codebase —
      // this is the first time ESLint has ever run here. `no-explicit-any`
      // alone accounts for ~500 of the ~680 findings on first run; erroring
      // on it would mean hand-typing hundreds of pre-existing `any` usages
      // before CI could ever go green, which is its own separate effort,
      // not something to block this pass on. Downgraded to warn rather than
      // fixed or disabled outright so the signal stays visible and new
      // code is still nudged away from it — tighten back to 'error' once
      // the backlog is actually paid down.
      '@typescript-eslint/no-explicit-any': 'warn',
      // eslint-plugin-react-hooks v7's `recommended` preset added several
      // new React-Compiler-oriented rules (refs/set-state-in-effect/purity/
      // preserve-manual-memoization) beyond the classic rules-of-hooks +
      // exhaustive-deps pair — genuinely useful, but this codebase doesn't
      // use React Compiler and these have real false-positive potential
      // against existing, deliberate patterns (e.g. this app's documented
      // "hydrate on first data arrival" state-in-render pattern used
      // throughout, which looks like a set-state-in-effect violation to a
      // rule tuned for Compiler compatibility but isn't one). Same
      // downgrade-not-disable reasoning as no-explicit-any above.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      // `condition && doSomething()` / `condition ? doA() : doB()` used as
      // bare statements (not JSX expressions) are deliberate, consistently-
      // used idioms throughout this codebase for "call one of these only
      // based on a condition" — not accidentally orphaned expressions.
      // Every no-unused-expressions finding on first run was one of these
      // two patterns; allowing them is the correct fix, not rewriting ~30
      // call sites to `if` statements.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      // `_`-prefixed params are this codebase's existing convention for
      // "unused but required for signature compatibility" (e.g. callback
      // signatures where only some positional args are needed) — not dead
      // code to remove.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Empty `catch {}` blocks in this codebase are deliberate best-effort
      // swallows (e.g. localStorage writes, optimistic JSON parses) — not
      // accidentally-forgotten error handling.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
