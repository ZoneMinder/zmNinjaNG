# Testing playbook

Read before tests, UI work, navigation work, or platform checks.

## Test design

- Test outcomes a person sees: changed data, navigation, rendered real data, persistence after refresh, errors, and edge cases.
- Unit tests live beside source in `__tests__/`.
- Browser e2e uses `app/tests/features/*.feature` and screen-specific step files in `app/tests/steps/`. Do not add direct Playwright specs.
- Test UI and navigation changes with relevant feature e2e.
- New interactive UI needs a kebab-case `data-testid`.
- Do not use fixed `waitForTimeout`. Use auto-retrying `expect`.
- Capability-based e2e skips must derive from API or fixture data, never visibility of UI under test. When capability exists, assert the UI.

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

