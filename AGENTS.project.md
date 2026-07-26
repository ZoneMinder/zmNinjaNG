# zmNinjaNg Project Instructions

Read `AGENTS.md` first. Contracts, project rules, verification, playbooks.
The sanctioned path is the only path; a bypass is a bug even when it works.

## Architecture contracts

### Settings
Owns: all profile-scoped user preferences.
Path: `getProfileSettings` / `updateProfileSettings` (`app/src/stores/settings.ts`); every coercion or default lives in `mergeProfileSettings`.
Never: direct storage access; non-profile-scoped preference keys; coercions outside the merge (reactive readers such as `useCurrentProfile` bypass per-getter fixes).
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Polling
Owns: every recurring refresh interval.
Path: `useBandwidthSettings` / `getBandwidthSettings` (`app/src/hooks/useBandwidthSettings.ts`).
Never: literal interval values; users tune bandwidth globally.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### HTTP
Owns: all network requests, including native TLS handling.
Path: helpers in `app/src/lib/http.ts`.
Never: raw `fetch` or `axios`.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Logging
Owns: all diagnostic output.
Path: `log` helpers with explicit `LogLevel` (`app/src/lib/logger.ts`).
Never: `console` calls in app code; credentials or tokens in log output or URLs.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Auth tokens
Owns: token storage, refresh, and login concurrency.
Path: `getFreshAccessToken` / `login` on the auth store (`app/src/stores/auth.ts`), deduped through one in-flight promise; refresh tokens in platform secure storage.
Never: refresh calls bypassing the dedup entry points; tokens in URL query strings; plaintext fallback when secure storage fails (drop and re-auth instead).
Gate: `app/src/stores/__tests__/auth.test.ts`.

### Assistant tool loop
Owns: whether an assistant turn may answer a data question.
Path: the turn schema makes the answer branch unreachable until a real tool result exists; execution authority is the turn's own `opts.tools`, not the registry.
Never: prompt-only grounding guards; raw tool-error text fed back to the model; unparsed tool-call markup rendered as an answer.
Gate: `app/src/lib/assistant/__tests__/agent.test.ts`; `app/src/lib/assistant/__tests__/grounding.test.ts`.

### Server queries
Owns: React Query keys, invalidation, and caching.
Path: keys and invalidations from `app/src/lib/query/query-keys.ts`; profile-scoped keys wrap ids with `asProfileId`.
Never: inline key arrays; unwrapped profile ids in keys.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Stores
Owns: client state via Zustand.
Path: subscriptions select every reactive field they read, with `useShallow` for multi-field selects (`app/src/stores/`).
Never: mutating objects returned by `getState`; whole-store subscriptions.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Service boundary
Owns: the dependency direction between services and stores.
Path: services reach stores only through gates; the module graph stays acyclic.
Never: a service statically importing a store.
Gate: `app/src/tests/no-circular-deps.test.ts`.

### Query UI states
Owns: what users see while data loads or fails.
Path: `ErrorBanner` (`app/src/components/ui/query-state.tsx`) with `resolveQueryError` (`app/src/lib/query/query-error.ts`); shared query-state skeletons for loading.
Never: ad-hoc error markup or raw error strings.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Date and time
Owns: user-facing date and time rendering.
Path: `useDateTimeFormat` (`app/src/hooks/useDateTimeFormat.ts`) or `formatAppDate` helpers (`app/src/lib/format-date-time.ts`).
Never: literal date-fns pattern strings in components.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Localization
Owns: all user-facing text.
Path: locale files under `app/src/locales/` (de, en, es, fr, zh); every locale updates together; both pickers list every locale.
Never: hardcoded user-facing strings; a string added to one locale only.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Native
Owns: everything touching Capacitor or platform APIs.
Path: Capacitor plugins import dynamically behind a platform check, with a test mock; mobile downloads use Capacitor HTTP base64; native TLS trust-on-first-use accepts any certificate when no fingerprint is stored.
Never: static plugin imports; Blob conversion for mobile downloads; fail-closed TLS without stored fingerprint (breaks self-signed onboarding).
Gate: `app/src/tests/agents-contracts.test.ts`; review.

### Constants
Owns: semantic values shared across modules.
Path: app-level values in `app/src/lib/zmninja-ng-constants.ts`; ZoneMinder protocol values in `app/src/lib/zm/zm-constants.ts`.
Never: magic numbers or strings inline where a named constant exists or belongs.
Gate: `app/src/tests/agents-contracts.test.ts`; review.

## Project rules

- Run npm commands from `app/`. Run root `npm install` once so hooks exist.
- UI changes need an outcome-based e2e test with platform tags and `data-testid` on new interactive elements.
- Only one `npm run test:e2e` per working tree.
- Device e2e (iOS, Android, Tauri) is manual-only; agents never auto-run it.
- Labels must fit 320px; prefer concise translations.
- Flex text uses `min-w-0`, `truncate`, and a `title`; multi-line text uses `line-clamp-N`.
- Do not commit incidental native build-number bumps. Commit intended bumps alone as `chore:`.
- GitHub comments identify Claude assisting @pliablepixels, with that exact line. Commits do not.
- Label issues and PRs `core` (behavior changes) or `refactor` (behavior-preserving). The label-guard workflow auto-assigns PRs from commit types; hand labels win.
- Test builds use a matching GitHub workflow; add one only when none fits.
- Developer docs teach React where they first rely on it.

## Verification

```
npm test
npx tsc -b
npm run build
npm run lint:a11y
npm run lint:correctness
npm run lint:ratchet
npm run test:e2e -- <feature>.feature
```

Per commit, run what the change touches (docs-only edits: the doc gates in
`src/tests/`; code: its unit tests). The full list runs before push or PR.
The three lint commands are the blocking ones; `npm run lint` stays
advisory. The e2e command applies to UI, navigation, and workflow changes.
The ratchet baseline lives at `app/.lint-baseline.json`; lower it with
`npm run lint:ratchet -- --update`. State completed checks in handoff.

## Playbooks

Read each listed playbook before work in that area.

| Work | Read first |
|---|---|
| Tests, UI, navigation, or platform checks | `agents/project/testing.md` |
| Developer or user documentation | `agents/project/documentation.md` |
| Capacitor, TLS, Electron, downloads, or native paths | `agents/project/native.md` |
| Assistant tools, WebLLM, or ZoneMinder schemas | `agents/project/data-integrity.md` |
| Prompts, providers, or LLM model choices | `agents/project/llm-models.md` |
| ZoneMinder APIs, streaming, or platform quirks | `agents/project/domain-context.md` |

Portable playbooks live in `agents/generic/`; project ones in
`agents/project/`.
