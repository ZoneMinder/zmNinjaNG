// Dedicated a11y-only lint gate (refs #217 finding 7).
//
// The full `eslint .` run (eslint.config.js) is advisory in CI and pre-commit
// because of a pre-existing ~170-error backlog (react-hooks/*, no-explicit-any).
// That backlog swallows jsx-a11y regressions: a new a11y violation would not
// fail anything. This config lints the same TS/TSX sources but enables ONLY
// the jsx-a11y rules (recommended set, all at error), with every other rule
// off. It is blocking in both CI (see .github/workflows/ci.yml) and
// .husky/pre-commit, independent of the advisory full-lint backlog.
//
// The other rule sets (js, typescript-eslint, react-hooks, react-refresh) are
// still pulled in via `extends` so their plugins register their rule names
// with ESLint. That keeps existing `// eslint-disable-next-line <rule>`
// comments for those rules resolvable (as unused-disable warnings, not
// "rule not found" errors) without re-enabling any of them here.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

function allOff(rules) {
  return Object.fromEntries(Object.keys(rules ?? {}).map((name) => [name, 'off']))
}

const tseslintRulesOff = Object.fromEntries(
  tseslint.configs.recommended
    .flatMap((config) => Object.keys(config.rules ?? {}))
    .map((name) => [name, 'off']),
)

export default defineConfig([
  globalIgnores([
    'dist',
    'android',
    'ios',
    'coverage',
    'node_modules',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    // Other rule sets are all forced off below, so their existing
    // eslint-disable comments are "unused" here by design. That is noise
    // for a gate whose only job is jsx-a11y regressions, not disable-comment
    // hygiene for rules this config doesn't enforce.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      ...allOff(js.configs.recommended.rules),
      ...tseslintRulesOff,
      ...allOff(reactHooks.configs.flat.recommended.rules),
      ...allOff(reactRefresh.configs.vite.rules),
      // Only jsx-a11y rules are enforced by this config.
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
])
