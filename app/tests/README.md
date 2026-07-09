# Cross-Platform Test Setup

This guide covers setting up and running the cross-platform tests.

Two separate suites exist, and they do different things:

| Suite | Driver | What it runs | When |
|---|---|---|---|
| Web e2e | Playwright | The Gherkin feature files in `tests/features/` | `npm run test:e2e`, and in CI |
| Device screenshots | WebDriverIO + Appium | `tests/device-screenshots/specs/capture-screens.spec.ts` | Manual invocation only |

The feature files run on desktop Chromium and nowhere else. `playwright.config.ts` declares a single `chromium` project and nothing filters scenarios by tag, so every scenario runs on every `npm run test:e2e`, whatever its tags say. The device suite never reads the feature files: it logs in, walks each screen, and saves PNGs.

There is no visual comparison. Nothing in this repo diffs a screenshot against a baseline.

---

## 1. Prerequisites

Install these tools before running any platform tests:

| Tool | Version | Notes |
|---|---|---|
| Xcode | 15+ | Required for iOS simulators and `xcrun simctl` |
| Android Studio | Latest | Required for AVD manager and Android SDK |
| Node.js | 20+ | Required for all npm scripts |
| Appium | 2.x | Global install; manages iOS and Android drivers |

---

## 2. First-Time Setup

Run these steps once on a new machine. After completing all steps, run `npm run test:platform:setup` from `app/` to verify everything is ready.

### Android

1. Open Android Studio → Virtual Device Manager → Create Device.
2. Select **Pixel 7** as the hardware profile.
3. Select system image: **API 34**, **arm64-v8a**, `google_apis` image (required for Apple Silicon Macs).
4. Name the AVD **`Pixel_7_API_34`** (this is the default name expected by the config).
5. Finish creating the AVD.
6. Verify `adb` is on your PATH:
   ```bash
   adb version
   ```
   If not found, add `$ANDROID_HOME/platform-tools` to your shell PATH.

### iOS

1. Open Xcode → Settings → Platforms → click **+** to add a platform.
2. Install **iOS 17** simulator runtime (download size is several GB).
3. Verify the required simulators exist:
   ```bash
   xcrun simctl list devices | grep -E "iPhone 15|iPad Air"
   ```
   You need both **iPhone 15** and **iPad Air 11-inch (M2)** listed. If missing, add them via Xcode → Window → Devices and Simulators.

### Appium

```bash
npm install -g appium
appium driver install xcuitest
appium driver install uiautomator2
```

Verify:
```bash
appium --version        # should be 2.x
appium driver list      # should show xcuitest and uiautomator2 as installed
```

### Verify All Setup

From the `app/` directory:

```bash
npm run test:platform:setup
```

This checks Xcode, iOS runtime, simulators, Android SDK, AVD, adb, Appium drivers, and port availability. Any failing check includes a fix instruction.

---

## 3. Platform Config

### Default Config

`app/tests/platforms.config.defaults.ts` ships with the repo and contains the default simulator names, ports, and timeouts:

- Android AVD: `Pixel_7_API_34`
- iOS phone simulator: `iPhone 15` (iOS 17.5)
- iOS tablet simulator: `iPad Air 11-inch (M2)` (iOS 17.5)
- Appium port: `4723` (iOS). The Android run uses `4724`, hardcoded in `wdio.config.device-screenshots.ts`.
- App launch timeout: `30000` ms
- WebView switch timeout: `10000` ms

### Local Overrides

To use different simulator names or ports, copy the defaults file:

```bash
cp app/tests/platforms.config.defaults.ts app/tests/platforms.config.local.ts
```

The `*.local` gitignore pattern already covers this file, so it will not be committed.

Edit `platforms.config.local.ts` with your values. The config loader merges local over defaults at startup. You only need to set the fields you want to change.

### Finding Your Simulator Names

```bash
# List iOS simulators
xcrun simctl list devices

# List Android AVDs
emulator -list-avds
```

Use the exact name shown in the output as the value in your local config.

### Server Credentials

E2E tests connect to a real ZoneMinder server. Set credentials in `app/.env`:

```env
ZM_HOST_1=http://your-server:port
ZM_USER_1=admin
ZM_PASSWORD_1=password
```

---

## 4. Running Tests

All commands run from the `app/` directory.

### Web E2E (fast, no devices needed)

| Command | Description |
|---|---|
| `npm run test:e2e` | All web browser tests |
| `npm run test:e2e -- tests/features/dashboard.feature` | Single feature file |
| `npm run test:e2e -- --headed` | See the browser |
| `npm test` | Unit tests (Vitest, no server needed) |
| `npm run test:all` | Unit + web E2E |
| `npm run test:platform:setup` | Verify tools and simulators are ready |

### Device Screenshot Capture (requires simulators/emulators)

Every device command below runs the same thing: `wdio.config.device-screenshots.ts`, whose only spec is `tests/device-screenshots/specs/capture-screens.spec.ts`. It logs in, visits each screen, and writes a portrait and a landscape PNG. It runs no Gherkin scenario and asserts nothing.

The `test:e2e:*` names are historical. They do not run the e2e feature suite.

| Command | Equivalent | Target |
|---|---|---|
| `npm run test:screenshots:android` | `bash scripts/test-android.sh` | Pixel 7 emulator |
| `npm run test:screenshots:ios-phone` | `bash scripts/test-ios.sh phone` | iPhone 15 simulator |
| `npm run test:screenshots:ios-tablet` | `bash scripts/test-ios.sh tablet` | iPad Air simulator |
| `npm run test:e2e:android` | same script as `test:screenshots:android` | Pixel 7 emulator |
| `npm run test:e2e:ios-phone` | same script as `test:screenshots:ios-phone` | iPhone 15 simulator |
| `npm run test:e2e:ios-tablet` | same script as `test:screenshots:ios-tablet` | iPad Air simulator |
| `bash scripts/test-all-platforms.sh` | web e2e, then all three device captures | all |

The `scripts/test-*.sh` wrappers add a Capacitor sync (`npm run android:sync` / `npm run ios:sync`) before launching wdio. That sync bumps native build numbers; see rule 28 in `AGENTS.md` before committing.

#### Android

```bash
cd app && npm run android:sync
bash scripts/test-android.sh
```

**How it works:** Appium's UiAutomator2 driver installs and launches the APK on the emulator, with `autoWebview` switching into the Capacitor WebView context. WebDriverIO then finds elements by `data-testid`. Appium listens on port `4724` for Android.

#### iOS (iPhone and iPad)

```bash
cd app && npm run ios:sync
bash scripts/test-ios.sh phone     # or: tablet
```

**How it works:** Appium's XCUITest driver launches the app on the simulator and switches into the WKWebView context. WebDriverIO connects to Appium on port `4723`. The tablet variant targets `iPad Air 11-inch (M2)`.

#### Output

Screenshots land in a dated directory per device:

```
tests/screenshots/devices/<device-name>-<YYYY-MM-DD>/
```

Nothing compares them against a reference. They are for a human to look at. Do not commit them.

### Platform Tags

Scenarios carry tags, but no runner filters on them today: `npm run test:e2e` runs every scenario in `tests/features/` on desktop Chromium. Treat a tag as a statement of where the scenario is *meant* to be meaningful.

| Tag | Meaning |
|---|---|
| `@all` | Not specific to one platform |
| `@web` | Browser only (for example, hover, or an explicit `setViewportSize`) |
| `@tauri` | Tauri desktop |
| `@android` | Android-specific behavior |
| `@ios-phone` | iPhone form factor |
| `@ios-tablet` | iPad form factor |

There is no bare `@ios` tag. Scenarios that need a phone or tablet viewport set it explicitly with `Given the viewport is mobile size` or `Given the viewport is tablet size`, which is why they are tagged `@web`: a real device ignores `setViewportSize`.

---

## 5. Architecture

### Two-Driver Design

| Driver | Suite | Why |
|---|---|---|
| **Playwright** | Web e2e (the feature files) | Drives desktop Chromium directly |
| **WebDriverIO + Appium** | Device screenshot capture | Drives the Capacitor WebView inside a real app process (UiAutomator2 on Android, XCUITest on iOS) |

Playwright never touches a device. There is no `connectOverCDP()` anywhere in this repo.

### Step Definitions

Step definitions in `tests/steps/` use Playwright's `page` fixture directly (`page.getByTestId(...)`, `page.click(...)`, etc.). There is no shared driver abstraction layer, because only Playwright reads them.

Steps must assert, not sleep. See rule 34 in `AGENTS.md`.

### Config Loader

`tests/platforms.config.ts` loads defaults from `platforms.config.defaults.ts` and merges any overrides from `platforms.config.local.ts` (gitignored). The merged config provides simulator names, ports, timeouts, and app paths to all test infrastructure.

### Helper Modules

| File | Purpose |
|---|---|
| `tests/helpers/config.ts` | Loads server credentials from `.env` |
| `tests/helpers/ios-launcher.ts` | Builds iOS app, boots simulators, generates Appium capabilities |
| `tests/helpers/zm-api.ts` | Talks to the ZoneMinder API directly, so a step can learn a server-side fact (monitor count, PTZ capability) without asking the UI it is testing |

---

## 6. Adding Tests

See the **Testing** section in `AGENTS.md` for the full workflow.

Summary:

1. Write a human test plan. What would a QA tester check?
2. Add Gherkin scenarios to the appropriate `tests/features/<screen>.feature` file.
3. Add step definitions to `tests/steps/<screen>.steps.ts` using Playwright's `page` fixture directly.
4. Assert the outcome the scenario name promises. A scenario that cannot assert its name at desktop Chromium width must be renamed to what it does assert.
5. Run `npm run test:e2e -- <feature>.feature` and confirm it fails before your change and passes after.

Native-only flows (biometrics, push, the share sheet, app lifecycle) have no automated coverage. Verify them by hand on a device and say so in the PR. See rule 27 in `AGENTS.md`.

---

## 7. Troubleshooting

### "WebView context not found"

The app may not have finished loading when the test tried to switch context. Increase the `webviewSwitch` timeout in `platforms.config.local.ts`:

```typescript
timeouts: {
  webviewSwitch: 20000, // increase from default 10000
}
```

### "Appium can't find device" or "No device found"

The simulator or emulator name in config does not match what is installed. Check exact names:

```bash
xcrun simctl list devices     # iOS
emulator -list-avds           # Android
```

Update `platforms.config.local.ts` with the exact name shown.

### "Port already in use"

A previous test run left a process holding the port. Find and kill it:

```bash
lsof -ti :4723 | xargs kill   # Appium port (iOS)
lsof -ti :4724 | xargs kill   # Appium port (Android)
```

Or change the port in `platforms.config.local.ts` to an unused one.

### "bddgen missing steps" / step not found error

A step used in a `.feature` file has no matching implementation. Add the step definition to the appropriate `tests/steps/<screen>.steps.ts` file.

### "Emulator won't boot" or hangs at startup

Check the AVD name matches exactly:

```bash
emulator -list-avds
```

If the name is wrong, update `platforms.config.local.ts`. If the AVD is corrupted, delete and recreate it in Android Studio Virtual Device Manager.

### iOS build fails with xcodebuild

Ensure Xcode CLI tools are installed and agree to the license:

```bash
xcode-select --install
sudo xcodebuild -license accept
```

Then verify the correct SDK is available:

```bash
xcodebuild -showsdks | grep iphonesimulator
```
