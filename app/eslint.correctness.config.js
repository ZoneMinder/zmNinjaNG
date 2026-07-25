// Dedicated React-correctness lint gate (refs #281).
//
// eslint-plugin-react-hooks v7 runs the React Compiler's static analysis. Most
// of what it reports is performance advice (exhaustive-deps, refs,
// preserve-manual-memoization, static-components) and sits in the advisory
// backlog that keeps `eslint .` non-blocking in CI.
//
// Two of its rules are not advice. `purity` catches impure reads during render
// and `immutability` catches values mutated across a render boundary; both
// change behaviour once a component is memoized, and both were at zero when
// this gate was added. This config enables exactly those two, with every other
// rule off, so a regression fails the build without waiting for the rest of the
// backlog to be burned down.
//
// Same shape as eslint.a11y.config.js: other rule sets are still extended so
// their plugins register rule names and existing disable comments stay
// resolvable, then forced off.
//
// The compiler rules ignore eslint-disable-next-line and only honour
// file-scoped `/* eslint-disable react-hooks/purity */`. Two files carry one,
// each with the reason at the top of the file: src/hooks/useFreshAccessToken.ts
// and src/pages/Timeline.tsx.
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
    // Every other rule is off here, so their disable comments read as unused.
    // That is noise for a gate whose only job is these two rules.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      ...allOff(js.configs.recommended.rules),
      ...tseslintRulesOff,
      ...allOff(reactHooks.configs.flat.recommended.rules),
      ...allOff(reactRefresh.configs.vite.rules),
      ...allOff(jsxA11y.flatConfigs.recommended.rules),
      'react-hooks/purity': 'error',
      'react-hooks/immutability': 'error',
    },
  },
])
