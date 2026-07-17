# Development Guidelines

## Rules

These are non-negotiable. Every rule applies to all communication: responses, commits, docs, code comments.

1. **Plain, factual writing**. Applies everywhere: responses, commits, code comments, docs, PR bodies, issue descriptions.
   - **Banned superlatives and marketing speak**: comprehensive, critical, major, robust, powerful, extensively, thoroughly, excellent, amazing, significant, seamless, intuitive, user-friendly, modern, cutting-edge, state-of-the-art, best-in-class, ground-up rewrite, world-class, blazingly fast.
   - **Banned AI slop and storytelling**: "Let's...", "As you can see", "It's important to note", "Imagine you have...", "In the real world", "Key Takeaways" or "Summary" sections that restate what was already said, multi-paragraph "why we did it this way" essays.
   - **Banned hand-wavy claims**: "designed to scale", "built for the modern web", "production-ready". State the specific fact (e.g. "handles 50k events/min on a Pi 4") or cut the claim.
   - **No em-dashes** (—). Use a period, comma, colon, or rephrase. Example: replace "Token refresh runs every 60s — checks expiry and refreshes if within leeway" with "Token refresh runs every 60s. It checks expiry and refreshes if within leeway."
   - First-person honesty is fine ("this was primarily to educate me as I did not have React experience"). Don't sand it off.
   - **Teaching is not slop**: in `docs/developer-guide/`, a short concrete explanation of how a React mechanism behaves, placed where a doc first relies on it, is a fact the reader lacks, not storytelling. The bans on filler openers and recap sections still apply to it (rule 37).
2. **Issues first**: create a GitHub issue before implementing features or fixing bugs. If an issue already exists, refer to it. 
3. **Test first, verify before commit**: write the failing test first. Before every commit run `npm test`, `npx tsc -b`, `npm run build`, and the relevant e2e feature. Use `tsc -b`, not `tsc --noEmit`; the build's `tsc -b` catches stricter errors (unused variables, type narrowing). Never commit if any step fails.
4. **Update docs**: update `docs/developer-guide/` in the same session when adding new APIs, components, utilities, or hooks, or when a change alters a path that `docs/developer-guide/call-flows.rst` traces (update the trace, not just a chapter entry), and/or `docs/user-guide` for changed/updated or new functionality
5. **i18n all languages**: never hardcode user-facing strings. Update ALL translation files: en, de, es, fr, zh.
6. **Cross-platform**: test on iOS, Android, Electron desktop, phone portrait + landscape. Device e2e tests (`ios-phone`, `android`, etc.) are manual-invoke-only. Only `npm run test:e2e` (web) runs in the automated workflow.
7. **Profile-scoped settings**: read/write via `getProfileSettings`/`updateProfileSettings`. Never use global singletons.
8. **Bandwidth settings**: all polling/refresh features must use `useBandwidthSettings()` (or `getBandwidthSettings()` outside React). Never hardcode polling intervals.
9. **Logging**: use `log.*` component helpers with explicit LogLevel, never `console.*`. See `lib/logger.ts` for available helpers.
10. **HTTP**: use `lib/http.ts` abstractions (`httpGet`, `httpPost`, etc.), never raw `fetch()` or `axios`.
11. **Text overflow**: use `truncate` + `min-w-0` in flex containers; add `title` for tooltips. Multi-line: `line-clamp-N`.
12. **Small files, no dead code**: ~400 LOC max; extract complex logic to separate modules. DRY, but three similar lines beat a premature abstraction. Delete replaced code completely; no unused files or commented-out blocks.
13. **`data-testid`**: add `data-testid="kebab-case-name"` to all interactive elements. Required for e2e tests.
14. **Capacitor plugins**: dynamic imports only with platform checks. Never static imports. Match `@capacitor/core` major version. Add mock to `tests/setup.ts`.
15. **Mobile downloads**: use CapacitorHttp base64 directly. Never convert to Blob on mobile (OOM risk).
16. **No plan files in git**: delete `.md` plan files once the feature is complete.
17. **Complete features fully**: don't leave features half-implemented. When multiple viable approaches or UX changes exist, present options and get approval before implementing.
18. **User approval before merge**: never merge to main without user approval.
19. **One logical change per commit**: use conventional format: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`. When an issue exists for the work, every commit for it MUST reference it (`refs #<id>`; use `fixes #<id>` only after the user confirms the fix works). Never leave a commit unreferenced while an issue is open for it.
20. **Don't batch unrelated changes**: split into separate commits.
21. **Analyze test failures**: read error output and fix systematically. Don't retry blindly.
22. **Concise i18n labels**: button, tab, and action labels must be short in all languages; prefer single-word synonyms (ES "Ajustes" not "Configuración", DE "Speichern", FR "Enregistrer"). Translations must fit a 320px-wide screen; rule 11 is the safety net.
23. **Date/time formatting**: all user-facing date/time display must use `useDateTimeFormat()` hook (or `formatAppDate`/`formatAppTime`/`formatAppDateTime` from `lib/format-date-time.ts` outside React). Never hardcode date-fns `format()` with literal patterns for user-visible output. This includes canvas rendering, tooltips, labels, and scrubber overlays.
24. **Self-correcting rules**: keep this file current in the same session. Add or tighten a rule when user guidance establishes a general pattern, or when a bug or mistake surfaces that a rule could have prevented (including yours). Write the smallest general rule plus the why in a few words; never renumber existing rules (scripts and commits cite them). One-off facts tied to specific code go in a code comment at that site, not here.
25. **Centralized constants**: every named constant (timeouts, thresholds, storage keys, animation durations, magic numbers with semantic meaning) lives in `lib/zmninja-ng-constants.ts` (app-level) or `lib/zm-constants.ts` (ZoneMinder protocol-level). Import from there; do not redeclare per file. CSS pixel values inline in JSX/styles are fine; ad-hoc numbers used once with no semantic name are fine.
26. **Identify yourself on GitHub**: whenever you post a comment on a GitHub issue or PR, identify yourself as Claude assisting @pliablepixels. End the comment with a line such as `Posted by Claude, assisting @pliablepixels.` This line is only for GitHub comments. Never put it in git commit messages: commits use the usual `Co-Authored-By: Claude ...` signature and nothing else.
27. **Hardening must not silently break a feature**: a change on a native or CI-untestable path (TLS/certs, WebView, native plugins, Electron) is not done until the affected feature is verified on a real device. Prefer the least-breaking option; if a fix can only ship by breaking a working feature (TOFU must accept a cert before it can pin it), document it as accepted risk instead. Flag every native/Electron change as needing a device pass before merge.
28. **Don't commit incidental build artifacts**: `npm run android:sync` / `npm run ios:sync` (and anything that calls them, like `npm run android` / `npm run ios` / `make_release.sh`) run `scripts/sync-version.js`, which bumps native build numbers (`app/android/app/build.gradle` `versionCode`, `app/ios/App/App.xcodeproj/project.pbxproj` `CURRENT_PROJECT_VERSION`). `npm run build` alone does not write them. Revert bumps with `git checkout --` before committing a feature or fix; only ever commit a bump in a dedicated `chore:` commit.
29. **Query keys via the factory**: every React Query key and invalidation comes from `lib/query/query-keys.ts`; never write inline key arrays. Profile-scoped keys take a `ProfileId` minted through `asProfileId()`. Why: inline keys drift out of sync with invalidators and break cross-profile cache isolation.
30. **Zustand subscriptions are selective and immutable**: subscribe with field selectors or `useShallow`, never whole-store. When narrowing an existing subscription, keep every reactively-read field in the selector; an action-only selector compiles, renders once, then goes stale. Never mutate objects obtained from `getState()`; all changes go through store actions (in-place edits skip subscribers).
31. **Services never statically import stores**: invert the dependency with the gate/registration pattern (`api/store-gates.ts`, `setPushServiceStoreGates`). Keep `npx madge --circular` at zero; a new static store/service edge is a review blocker.
32. **Shared query error and loading UI**: error walls use `ErrorBanner` with `resolveQueryError(err, t)` (folds 401 into the localized auth prompt); loading states use the shared skeletons in `components/ui/query-state.tsx`. No hand-rolled `bg-destructive/10` divs or raw `error.message` rendering.
33. **lib/ placement**: new `lib/` modules go in their domain subfolder (`monitor/`, `event/`, `zm/`, `tv/`, `profile/`, `query/`, `security/`); top-level is reserved for cross-cutting singles (logger, platform, http, utils). No one-file folders.
34. **E2e steps assert, never mask**: no fixed `waitForTimeout` in new steps; use auto-retrying `expect` waits. Conditional guards must derive from API or fixture data (e.g. monitor `Controllable`), never from visibility of the element under test; when the capability is present, `Then` steps hard-assert. Why: a guard keyed on the UI under test turns its own regression into a green pass.
35. **Lint gates**: `lint:a11y` is blocking in CI and pre-commit; new interactive elements must pass it. The general lint gate is advisory only until the #217 backlog clears; new and edited files must not add violations to that backlog.
36. **Issue links must land, not be patched with a comment**: for issue-tracked work, land it via a PR that references the issue so GitHub links the commits automatically. Pushing commits to a scratch branch and then fast-forwarding them onto the default branch can consume the auto-reference (GitHub ties it to the first push it saw), leaving the issue unlinked. If told to commit straight to the default branch, push directly to it with no intermediate scratch branch, then check the issue timeline; post a manual linking comment (rule 26) only if the reference is still missing. Why: stops the repeated manual linking comments.
37. **Developer docs teach, they don't catalog**: `docs/developer-guide/` is written for a competent programmer with zero React experience. The first time a chapter relies on a React mechanism (effect, render, selector, query cache, portal), explain it in one or two sentences at the point of use or link the section of `02-react-fundamentals.rst` that covers it. Prefer narrative that follows real code end to end; `call-flows.rst` is the register to match (recipe in the Documentation section below). A new hook or component is not documented by appending a Location/Props/Used-By entry alone: connect it to the user-visible behavior it serves. Why: the #223 audit found reference-only appends and unexplained concepts were the guide's default failure mode.
38. **AGENTS.md is the single source for process rules**: `docs/developer-guide/` (09-contributing and 06-testing especially) cites a rule by number and links this file, never restates the rule's content. Why: restated copies drift silently; `npx tsc --noEmit` survived in the guide four times after rule 3 banned it.
39. **One e2e run per working tree**: never start a second `npm run test:e2e` while one is running in the same checkout. Playwright shares `test-results/` and `.features-gen/` across runs, so the second deletes the first's trace artifacts and the first reports `ENOENT` failures that look like real regressions. Wait, or use a separate checkout. Why: two agents running e2e concurrently produced 16 phantom failures.
40. **Read compiler and test output unwrapped**: when a wrapper summarizes a command (`rtk`), trust it for search and listing but not for verification gates. Run `./node_modules/.bin/tsc -b --force`, `vitest run`, and the e2e suite directly before claiming a gate passed. Why: a summarized `tsc` printed "No errors found" over a real TS2554.
41. **Never infer a merged config value from the one layer you can read**: when a library resolves config by merging sources (a fetched remote config, a bundled registry, call-site options), a value's absence in the layer you grepped says nothing about the merged result. State only what that layer shows, and treat the merged value as unverified until it runs. Why: `sliding_window_size` lives in web-llm's runtime-fetched `mlc-chat-config.json`, not its bundled registry; reading "no override in the registry" as "resolves to -1" shipped a `WindowSizeConfigurationError` on load for every sliding-window model (Gemma), and the wrong claim was written into a code comment as "Verified".
42. **A model's tool arguments are untrusted input**: an LLM tool `schema` (types, `enum`, `required`) is prose in a prompt that nothing enforces, and a TypeScript union proves nothing about what arrives at runtime. Validate every model-supplied value at the top of `execute`, and fail with a message naming the valid values, before it reaches a query. Why: a model sent `monitorId: "FrontDoor"` (a name, not an id) and `range: "last week"` (outside the enum); the name matched no rows and the range fell through an exhaustive switch to `undefined`, so a malformed, unscoped query returned `total: 0` and the assistant answered "no one came to your front door" about a camera it never queried. In a query tool an empty result is indistinguishable from a real answer, so silent input coercion becomes a confident false negative.

---

## Working Directory

All `npm` commands must be run from the `app/` directory.

Structure:
- `./`: workspace root (AGENTS.md, docs/, scripts/)
- `app/`: main application (run npm commands here)
- `app/src/`: source code
- `app/tests/`: e2e test features and helpers

One-time setup exception: run `npm install` at the repo root (`./`) once, before `cd app && npm install`. `.git` lives at the repo root, so the root install is what wires up the husky git hooks (commit-msg rule-28 native-version guard, pre-commit lint/tsc). Skipping it means every hook silently no-ops; CI (`.github/workflows/ci.yml`, `native-version-guard` job) re-checks rule 28 on every commit so a missing root install can't bypass it.

---

## Testing

Every test verifies what a human tester would: outcomes (data changed, navigation happened, data persists after refresh), never just element presence. Cover error states and edge cases. Never mock the thing under test.

### Unit Tests
**Location**: Next to source in `__tests__/` subdirectory (e.g., `lib/crypto.ts` → `lib/__tests__/crypto.test.ts`)

**What to test**: Happy path, edge cases (empty/null/undefined), error cases, state changes

**Run**: `npm test`

### E2E Tests
**When required**: UI changes, navigation changes, interaction changes, new workflows

**Location**: `app/tests/features/*.feature` (Gherkin format, never .spec.ts directly)

**Step definitions**: `app/tests/steps/<screen>.steps.ts` (one file per screen, not one monolith)

**Run**: `npm run test:e2e -- <feature>.feature`

### Cross-Platform E2E Tests
Only the web profile runs the Gherkin feature suite: `playwright.config.ts` defines a single chromium project, and `npm run test:e2e` is what CI runs. The three device profiles run a WebDriverIO + Appium screenshot suite (`wdio.config.device-screenshots.ts`), not the feature files, and are manual-invoke-only.

| Profile | Device | Driver | Runs |
|---|---|---|---|
| `web-chromium` | Desktop browser | Playwright | Gherkin feature suite (CI) |
| `android-phone` | Pixel 7 Emulator | WebDriverIO + Appium UiAutomator2 | Device screenshot suite (manual) |
| `ios-phone` | iPhone 15 Simulator | WebDriverIO + Appium XCUITest | Device screenshot suite (manual) |
| `ios-tablet` | iPad Air Simulator | WebDriverIO + Appium XCUITest | Device screenshot suite (manual) |

### Platform Tags
- `@all`: every platform | `@android`: Android only | `@tauri`: Tauri desktop
- `@ios-phone` / `@ios-tablet`: iOS form factors (no bare `@ios` tag exists)
- `@web`: browser only
(There is no `@visual` tag; see Visual Regression below.)

### Test Commands
```bash
# Unit tests
npm test                                # Unit tests
npm test -- --coverage                  # With coverage

# E2E tests (web browser only - fast)
npm run test:e2e                        # All web e2e tests
npm run test:e2e -- <feature>.feature   # Specific feature
npm run test:e2e -- --headed            # See browser

# Cross-platform e2e (requires simulators/emulators)
npm run test:e2e:android                # Android emulator
npm run test:e2e:ios-phone              # iPhone simulator
npm run test:e2e:ios-tablet             # iPad simulator
npm run test:e2e:all-platforms          # All platforms sequentially

# Device screenshot capture (Appium; manual-only)
npm run test:screenshots:android
npm run test:screenshots:ios-phone
npm run test:screenshots:ios-tablet

# Setup verification
npm run test:platform:setup             # Check tools, simulators, ports
```

### Platform Test Configuration
Simulator names, ports, and timeouts are in `app/tests/platforms.config.defaults.ts`. To customize for your machine, copy to `platforms.config.local.ts` (gitignored) and edit.

Server credentials in `.env`:
```bash
ZM_HOST_1=http://your-server:port
ZM_USER_1=admin
ZM_PASSWORD_1=password
```

### Visual Regression
There is none, by decision. The placeholder step, its `@visual` tags, and the unused helper were deleted rather than left asserting nothing (#233). A scenario must assert the behavior its name promises with a real, auto-retrying expectation. If you want pixel comparison back, build it before writing scenarios that claim it.

### Writing Good E2E Tests

Ask: "If I were a human QA tester with this feature on 5 devices, what would I check?"

**Good** (tests a user goal with interaction + outcome verification):
```gherkin
@all
Scenario: Create and verify a new widget
  Given I am logged into zmNinjaNg
  When I navigate to the "Dashboard" page
  And I open the Add Widget dialog
  And I select widget type "My New Widget"
  And I enter the title "Test Widget"
  And I save the widget
  Then the widget "Test Widget" should appear on the dashboard
  And the widget should display real data
  When I refresh the page
  Then the widget "Test Widget" should still be present
```

- One scenario per user goal, not per element
- Add `@ios-phone @android` for phone layout, `@ios-tablet` for tablet
- Step definitions in `app/tests/steps/<screen>.steps.ts` using Playwright's `page` fixture

### Conditional Testing Pattern
For features that depend on server data or device capability, gate on the capability from an INDEPENDENT source (API, fixture), never on visibility of the UI under test. A guard derived from the element under test converts that element's regression into a green pass (rule 34).

```typescript
// Good: capability from the API decides whether the feature applies.
let hasPTZ = false;

Given('I know the monitor capabilities', async () => {
  hasPTZ = await isMonitorControllable(monitorId); // tests/helpers/zm-api.ts
});

Then('I should see the PTZ control panel', async ({ page }) => {
  if (!hasPTZ) return; // monitor genuinely has no PTZ: not applicable
  await expect(page.getByTestId('ptz-controls')).toBeVisible(); // capability present: hard assert
});

// Bad: self-defeating. If the panel breaks, hasPTZ is false and every step skips.
// hasPTZ = await page.getByTestId('ptz-controls').isVisible().catch(() => false);
```

When an earlier step legitimately performed no action (zero events on a test server), downstream `Then` steps may skip, but the skip condition must be data (`eventCount === 0`), not a swallowed locator failure.

### Native-Only Tests (Appium)
There is no automated suite for flows requiring native OS interaction (PiP, biometric auth, push, native file downloads, share sheet, app lifecycle). The `tests/native/specs/` directory was deleted (#233): no runner ever globbed it, and its specs were `it.todo` stubs. Verify these flows on a device (rule 27) and say so in the PR. Wire a runner before adding specs back.

---

## Verification & Commits

For every code change, execute in order:

1. `npm test`: must pass
2. `npx tsc -b`: must pass
3. `npm run build`: must succeed
4. `npm run test:e2e -- <feature>.feature` (if UI/navigation changed)
5. Commit only after all pass

State which tests were run: "Tests verified: npm test ✓, tsc -b ✓, build ✓, test:e2e -- dashboard.feature ✓"

**UI changes also require**: `data-testid` on new elements, e2e tests in `.feature` file with platform tags, all language files updated.

**Native plugin changes also require**: a device pass (rule 27), stated in the PR. There is no automated native suite.

**Never commit if**: tests are failing, tests are missing for new functionality, or you haven't actually run them.

### Feature Workflow
1. Create GitHub issue: `gh issue create --title "feat: Description" --body "..." --label "enhancement"` (or `--label "bug"`)
2. Create branch: `git checkout -b feature/<short-description>` (no branch needed for bug fixes)
3. Write the failing test, implement, make it pass; run the full suite for regressions
4. Verify per the checklist above, then request user approval before merging
5. Tag commits `refs #<id>`; use `fixes #<id>` only after the user confirms the fix works

---

## Code Patterns

### Internationalization
```typescript
const { t } = useTranslation();
<h1>{t('setup.title')}</h1>
toast.error(t('montage.screen_too_small'));
```
Location: `app/src/locales/{lang}/translation.json`: update all 5 languages.

### Logging
```typescript
import { log, LogLevel } from '../lib/logger';
log.secureStorage('Value encrypted', LogLevel.DEBUG, { key });
log.profileForm('Testing connection', LogLevel.INFO, { portalUrl });
log.download('Failed to download', LogLevel.ERROR, { url }, error);
```
See `lib/logger.ts` for the full list of component-specific helpers (e.g., `log.auth`, `log.notifications`, `log.http`, etc.).

### HTTP Requests
```typescript
import { httpGet, httpPost, httpPut, httpDelete } from '../lib/http';
const data = await httpGet<MonitorData>('/api/monitors.json');
await httpPost('/api/states/change.json', { monitorId: '1', newState: 'Alert' });
```
Handles platform differences (Capacitor HTTP on mobile, fetch on web), logging, and authentication automatically.

### Date/Time Formatting
```typescript
// In React components
import { useDateTimeFormat } from '../hooks/useDateTimeFormat';
const { fmtDate, fmtTime, fmtTimeShort, fmtDateTime, fmtDateTimeShort } = useDateTimeFormat();
<span>{fmtDateTime(new Date())}</span>

// Outside React (services, renderers, canvas)
import { formatAppDate, formatAppTimeShort, type FormatSettings } from '../lib/format-date-time';
formatAppTimeShort(date, settings);
```
Never use `format(date, 'HH:mm')` or similar hardcoded patterns for user-visible output.

### Capacitor Dynamic Imports
```typescript
// Good
if (Capacitor.isNativePlatform()) {
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch { /* not available */ }
}
// Bad: static import breaks on web
import { Haptics } from '@capacitor/haptics';
```

For plugin event listeners in React, use `hooks/useCapacitorListener` instead of hand-rolling the dynamic-import + `addListener` + cleanup lifecycle; it handles the async-remove race on unmount.

### Background Tasks & Downloads
```typescript
const taskStore = useBackgroundTasks.getState();
const taskId = taskStore.addTask({
  type: 'download',
  metadata: { title: 'Video.mp4', description: 'Event 12345' },
  cancelFn: () => abortController.abort(),
});
taskStore.updateProgress(taskId, percentage, bytesProcessed);
taskStore.completeTask(taskId);
```

### Bandwidth Settings
Use `useBandwidthSettings()` in React components or `getBandwidthSettings(mode)` in services. See `BandwidthSettings` interface in `lib/zmninja-ng-constants.ts` for available properties.

```typescript
import { useBandwidthSettings } from '../hooks/useBandwidthSettings';
const bandwidth = useBandwidthSettings();

const { data } = useQuery({
  queryKey: queryKeys.monitors(profileId), // rule 29: factory keys only
  queryFn: getMonitors,
  refetchInterval: bandwidth.monitorStatusInterval,
});
```

To add a new polling property: add to the `BandwidthSettings` interface and both `normal`/`low` objects in `BANDWIDTH_SETTINGS` (low mode should be ~2x slower).

### Settings & Data Management
Settings must be profile-scoped via `getProfileSettings`/`updateProfileSettings`. Detect version/structure changes in stored data. If incompatible, prompt user to reset (don't crash).

### Adding Dependencies
1. Check compatibility: `npm info <package> peerDependencies`
2. For Capacitor plugins: match `@capacitor/core` major version
3. Update test mocks in `app/src/tests/setup.ts` if needed
4. Verify: `npm test && npm run build`

---

## Documentation

The developer guide's audience is a competent programmer with zero React experience (rule 37). Every doc change is judged against that reader.

### Where things go

Decide what kind of change it is before picking a file:

1. **The change alters a user-visible path** (data flow, auth, streaming, navigation, notifications, settings): the primary edit is the matching trace in `call-flows.rst`. If no flow covers the path and it is a main user journey, add one using the recipe below. A chapter entry is secondary.
2. **New leaf artifact nothing traverses** (utility, small component, hook): a chapter entry is enough, but it must say what user-visible behavior the artifact serves, not just list props.

Chapter homes:
- API modules (`api/*.ts`) → `07-api-and-data-fetching.rst`
- Feature components (`components/*.tsx`) → `05-component-architecture.rst`
- Shared/reusable components, utilities (`lib/*.ts`), services (`services/*.ts`) → `12-shared-services-and-components.rst`
- Hooks (`hooks/*.ts`) → the chapter of the feature they serve
- Generic React mechanisms → `02-react-fundamentals.rst`, taught once, linked from everywhere else

Document purpose, one usage example from real code, and platform-specific gotchas. Then connect it: name the behavior it serves and link the call flow or section that walks it.

### Call-flow recipe

Every flow in `call-flows.rst` follows this shape; new flows and flow edits must too:

- Title the flow after a **user action** ("Arming a monitor"), never a subsystem ("States API").
- Open with one paragraph giving the whole shape plus the single counterintuitive fact.
- One mermaid diagram: `sequenceDiagram` + `autonumber` for time-ordered flows, `graph LR` for data propagation. Alias participants to role names. One `Note over` marking the pivotal moment.
- 8 to 14 numbered steps. Each step: bold plain-language lead sentence stating behavior, then the file and exact symbol in double-backticks, then why the step sits where it does (prefer the counterfactual: "if X ran after Y, Z would break"), then one line with a `source` link and a `:doc:` link to the reference chapter for that layer.
- Teach React only at the point of use, in a subordinate clause tied to a concrete consequence in this app.
- State negatives where a reader would otherwise assume a feature exists ("there is no idle timeout").
- End by naming the adjacent flow.

### Style

The tone target is `docs/developer-guide/01-introduction.rst`. The structure target for anything that explains behavior is `call-flows.rst`. Match them.

In addition to rule 1 above:

- **No top-of-file Table of Contents.** Sphinx generates one from headings.
- **No "Next Steps" / "Continue to chapter X" sections.** The TOC handles forward navigation.
- **No "Key Takeaways" or "Summary" recaps.** If a fact is worth restating, put it in the body. Don't restate the chapter at the end of the chapter.
- **Don't reword passages already concise and factual.** Three similar lines beats a forced rewrite. Edit only what's wrong, padded, or unclear. This does not protect a passage that relies on an unexplained React concept: fix that one by explaining or linking (rule 37), not rewording.
- **Code examples must come from the actual codebase.** Verify with `grep` before writing or editing: every function, store, component, and prop name in an example must grep-hit in `app/src/` (or the example must be labeled as deliberately simplified from a named file). Function names get renamed, constants change values, files move. Why: the #223 audit found ~25 examples for code that never existed or was refactored away.
- **Cite specific values, not ranges.** Read the constant from `lib/zmninja-ng-constants.ts` and write that. "Refreshes within 30 minutes of expiry" beats "refreshes shortly before expiry".
- **Cross-references**: `:doc:\`relative-path\`` in RST, `{doc}\`relative-path\`` in Markdown. Verify the target file exists.
- **Honest first-person framing is welcome** when it's accurate ("I built this to learn React"). Don't replace it with corporate voice.
- **Trim around code, not the code itself.** When tightening, cut the prose paragraphs around an example before touching the example.
- **Match the canonical file shape**: title with section underline (RST) or `# Title` (Markdown), one-paragraph framing (or none), then sections. No preamble blocks announcing what the chapter will cover.

When adding a new chapter or rewriting an existing one, run a banned-words grep before committing:

```bash
grep -niE "\b(comprehensive|robust|powerful|extensively|thoroughly|excellent|amazing|seamless|cutting.edge|state.of.the.art|user.friendly|ground.up rewrite)\b" <file>
grep -n "—" <file>   # em-dashes
```

Both should return zero hits.
