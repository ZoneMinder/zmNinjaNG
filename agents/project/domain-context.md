# ZoneMinder domain context

Verified project intelligence for writing code: API quirks, platform
behavior, and approaches that already failed. Read before working on the
subsystem it covers. Feed new entries through the self-improvement protocol
(AGENTS.md M5) when a session learns a durable project fact the hard way.
Entries carry no personal data, hostnames, or addresses. If an entry stops
matching reality, fixing it is a protocol change like any rule edit.

## ZoneMinder API

- Events index filters: `Id IN (...)` works; the `Id:csv` form does not.
  `Tags.Id` accepts a single value only and cannot combine with `Id IN`.
  Repeating `MonitorId` params ORs them. Filter URLs cap out near 8KB;
  batch long id lists.
- Event Server v7.0.22 and later always sends a real `eid` in pushes. The
  historical fake-eid bug (a `Date.now()` value where an event id belongs)
  was app-side tray handling, not the ES.
- Native TLS trust is trust-on-first-use: with no stored fingerprint,
  accept any certificate. Fail-closed here breaks onboarding against the
  self-signed certificates most ZoneMinder servers run.

## Streaming and media

- Multipart MJPEG renders fine inside `<img>` on WKWebView (iOS and macOS)
  and Chromium. The data-URL rendering workaround exists only for
  WebKitGTK on Linux (Tauri), where streaming leaks NetworkProcess memory
  and `ImageDecoder` is absent. Do not extend the workaround to other
  platforms.

## Platform quirks

- iOS WKWebView can stop updating `env(safe-area-inset-*)` after rotation;
  `main.tsx` recomputes them manually. Do not remove that workaround.
- On-device WebLLM crashes iOS WKWebView (about 2GB jetsam limit). It is
  gated off on iOS; remote Ollama is the supported path there.
- Google Play's native debug-symbols warning for Android builds is inherent
  to stripped Google dependencies and cannot be cleared.

## Libraries and state

- React Query v5: disabled queries report `isLoading: false`. Gate
  self-heal and reset effects on `isSuccess`, never on `isLoading`.
- `useCurrentProfile` reads the settings store reactively and bypasses
  per-getter fixes; settings coercions belong in `mergeProfileSettings`
  (see the Settings contract).
- List virtualization of EventListView and Logs with
  `@tanstack/react-virtual` failed twice (blank rows, stale text). Do not
  re-attempt without a materially different approach.

## Hardware and CI limits

- Every monitor on the CI test server has `Controllable: 0`, so PTZ is
  untestable in CI; PTZ verification is manual.
- PTZ `HoldButton` must stop the command on unmount, or a held camera
  keeps panning.

## Assistant and LLM backends

- The Ollama tag `qwen3:4b` resolves to the Thinking-2507 build whose
  reasoning cannot be disabled; use `qwen3:4b-instruct` when reasoning is
  unwanted. WebLLM disables thinking via `extra_body: { enable_thinking:
  false }`.
- The Apple Foundation Models backend invents tool arguments; validate
  tool-call args from it before use.
