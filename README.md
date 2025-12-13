# zmNg - Modern ZoneMinder Client

[View Comparison with zmNinja](notes/COMPARISON.md)

<img src="app/assets/logo.png" align="right" width="120" />

A modern web and mobile application for ZoneMinder home surveillance systems, providing a clean, intuitive interface for viewing live camera feeds, reviewing events, and managing multiple server profiles. It is a ground-up rewrite of the original [zmNinja](https://zmninja.zoneminder.com/) application, using modern web technologies and a more intuitive user interface. The code was 99% Claude CLI generated.

Watch a video of the demo [HERE](https://youtu.be/ces_2ap-htc)

### Screenshots
<sub><sup>frames courtesy [appleframer](https://appleframer.com/)</sup></sub>

<p align="center">
  <img src="images/1.png" width="32%" />
  <img src="images/2.png" width="32%" />
  <img src="images/3.png" width="32%" />
</p>
<p align="center">
  <img src="images/4.png" width="32%" />
  <img src="images/5.png" width="32%" />
  <img src="images/6.png" width="32%" />
</p>
<p align="center">
  <img src="images/7.png" width="32%" />
  <img src="images/8.png" width="32%" />
  <img src="images/9.png" width="32%" />
</p>

## Quick Start

### Prerequisites
- Node.js 18+ and npm ([download](https://nodejs.org/en/download))
- For desktop builds: Rust toolchain (for Tauri builds)

### Limitations
- Self signed/untrusted certificates are not supported. It's not worth the effort to support them. Please use LetsEncrypt or other free certs

### Desktop Development

```bash
git clone https://github.com/pliablepixels/zmNg
cd zmNg/app
npm install

# Desktop development (Tauri - native app)
npm run tauri:dev
```

### Desktop Production Builds

```bash
# Web production build
npm run build          # Output: dist/
npm run preview        # Preview production build

# Desktop production build (Tauri)
npm run tauri:build    # Output: src-tauri/target/release/bundle/
```

Deploy web build (`dist/`) to: Netlify, Vercel, GitHub Pages, AWS S3, etc.

### Mobile Builds

📱 **For Android setup and builds, see [ANDROID_BUILD.md](ANDROID_BUILD.md)**

📱 **For iOS setup and builds, see [IOS_BUILD.md](IOS_BUILD.md)**

## Testing

The project includes unit tests and end-to-end (E2E) tests to ensure code quality and reliability.

### Unit Tests

Run unit tests with Vitest:

```bash
cd zmNg/app

# Run all unit tests
npm run test:unit

# Run tests in watch mode
npm run test:unit -- --watch

# Run with coverage report
npm run test:coverage

# Run specific test file
npm run test:unit -- src/lib/__tests__/url-builder.test.ts
```

Coverage reports are generated in `coverage/` directory.

### End-to-End Tests

Run E2E tests with Playwright:

```bash
# Run E2E tests
npm run test:e2e

# Run with UI mode (visual debugging)
npm run test:e2e:ui

# Run specific test file
npm run test:e2e -- tests/monitors.spec.ts
```

**Note:** E2E tests require a running ZoneMinder server. Configure test credentials in `.env` file (see `.env.example`).

### Run All Tests

```bash
# Run both unit and E2E tests
npm run test:all
```

### Linting

Check code quality with ESLint:

```bash
npm run lint
```
