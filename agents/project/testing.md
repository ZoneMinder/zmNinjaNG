# Testing playbook

Read before tests, UI work, navigation work, or platform checks.

## Test design

- Test outcomes a person sees: changed data, navigation, rendered real data, persistence after refresh, errors, and edge cases.
- Route new tests by tier: pure logic in `lib/`, stores, and hooks gets unit tests; user-visible behavior or navigation gets a feature e2e scenario plus units for the logic beneath; native-only flows rely on manual device checks. E2e asserts the journey, units the edge cases; do not cover the same assertion in both tiers.
- Unit tests live beside source in `__tests__/`.
- Browser e2e uses `app/tests/features/*.feature` and screen-specific step files in `app/tests/steps/`. Do not add direct Playwright specs.
- Test UI and navigation changes with relevant feature e2e.
- New interactive UI needs a kebab-case `data-testid`. Repeated elements suffix the entity id (`monitor-card-${monitor.Id}`); variants suffix kind or role (`assistant-message-${msg.role}`).
- Do not use fixed `waitForTimeout`. Use auto-retrying `expect`.
- Capability-based e2e skips must derive from API or fixture data, never visibility of UI under test. When capability exists, assert the UI.
- Every `Then` step asserts, through `expect` or an `assert*` helper, and every step definition is referenced by a feature. `app/src/tests/e2e-steps.test.ts` fails the unit suite otherwise, so a step that cannot fail and a step nothing runs both surface without an e2e run.

## Platforms

- Automated e2e is Chromium only: `npm run test:e2e`.
- Android, iPhone, and iPad suites are manual Appium screenshot checks.
- Native OS flows such as PiP, biometrics, push, downloads, sharing, and lifecycle require device verification.
- UI work considers Electron, iOS, Android, portrait, and landscape. Record unavailable manual checks in handoff.

## Commands

```bash
# Run from app/
npm test
npx tsc -b
npm run build
npm run test:e2e -- <feature>.feature
npm run test:e2e
npm run test:e2e:android
npm run test:e2e:ios-phone
npm run test:e2e:ios-tablet
```

Never run two web e2e suites in one checkout. They share generated files and result paths.

