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
- Stream teardown sends `CMD_QUIT` for the previous connkey before starting
  a new stream, on every path: unmount, profile switch, manual retry, and
  tab-visibility resume. Missing one path leaves stale ZMS processes on the
  server (ee8a7c9d, bef8c42d, e261e539).
- Electron background/occlusion process switches do not fix MJPEG going
  blank on occluded windows; tried and reverted (69990402). The fix is
  stream-level reconnect on focus or visibility return (f7a8292e).
- Tauri snapshot thumbnails fetch as blob URLs, or WebKitGTK leaks sockets;
  same constraint as the MJPEG workaround, separate code path (7e121140).
- iOS video.js fullscreen: CSS overrides cannot reliably intercept the
  video.js toggle; native iOS fullscreen is the working approach, and the
  `capacitor://` status banner is the accepted tradeoff (efda381a).
- Do not skip HLS on Tauri for CORS: the CORS failure is a dev-mode origin
  artifact; let video.js try HLS and fall back to ZMS (b4299c59).
- `videojs-markers` is called as a plugin method (`player.markers(...)`)
  and initialized once per player instance; per-render re-init breaks
  markers (d0b251f7). Player `CMD_QUIT` teardown also guards React
  StrictMode double-invoked effects (fe042a14).

## Montage layout

- `react-grid-layout` keeps `compactType: 'vertical'` and
  `preventCollision: false`; the other values silently break resize
  handles, tried and reverted same-day (582b3a85, 1685ff90).
- Responsive drag/resize montage editing (phone reorder, tablet targets)
  was built and reverted for a "use a larger screen" toast; montage editing
  stays desktop-only by design (90a7e1da). Do not re-attempt without a
  materially different approach.
- Compact/density-mode CSS overrides scope to the compact-mode container,
  never bare element or utility selectors; global overrides bled into
  unrelated views three times (86e7c984, 7e69c0d7, 17613d3e).

## Auth and tokens

- Token refresh and login dedupe concurrent callers through the single
  in-flight promise in the auth store (`getFreshAccessToken` / `login`);
  independent triggers double-POST, and a double refresh 401s the rotated
  token and force-logs-out the user (26b9e6a9, 19fb60e1).
- Credentials never ride URL query strings; a refresh token in `?token=`
  leaked into server logs (e1393724). Request body only.
- Refresh tokens live in platform secure storage (Keychain, Keystore,
  `safeStorage`, web AES-GCM). On secure-store failure, drop the token and
  force re-auth; never fall back to plaintext (a2cc647d). Web at-rest
  crypto is obfuscation, not confidentiality.
- A ZoneMinder server with auth disabled returns login success with no
  tokens: track `requiresAuth` explicitly instead of deriving freshness
  from token presence, or no-auth servers refresh-loop forever (cf0d3b8f).

## Platform quirks

- iOS WKWebView can stop updating `env(safe-area-inset-*)` after rotation;
  `main.tsx` recomputes them manually. Do not remove that workaround.
- Separately: do not add JS `orientationchange` handlers on iOS (video
  resume, viewport-meta toggling). They interfere with WKWebView's layout
  pass and desync safe-area insets; tried and reverted (d1112e17,
  54af0cfe). CSS-only rotation fixes are the supported path; HTML5 video
  pausing on rotation is accepted behavior.
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
- The React Compiler lint reports at most one violation per function and
  only file-scoped `eslint-disable` comments silence it; fixing one
  violation can reveal the next on the same function.

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
  tool-call args from it before use. It also calls real tools on greeting
  turns that need no data: first tool call on a tool-less turn gets a
  no-tools pushback, and the registry unlocks only if the model insists
  with a second call (578787dc).
- On small and on-device models, prompt instructions alone do not stop
  fabricated answers: the turn schema itself must make the answer branch
  unreachable until a real tool result exists (4ee2bbbf, 0a720c01). See
  the Assistant tool loop contract.
- A schema-rejected or thrown tool call must not feed raw error text back
  to the model; it fabricates an answer from the error. Failure paths
  append an explicit correct-and-retry-or-admit guard (0a720c01).
- Tool-call markup the parser does not recognize (Hermes XML, bare
  name/arguments JSON) is a parse failure that triggers self-repair retry;
  it never renders verbatim as the chat answer (2e28e5fc).
- Regex "call a tool" nudges are English-only by construction; gate them on
  `ToolContext.locale` and give other locales a language-neutral reminder
  (e74bcb84).
- Measure assistant prompt changes with `app/scripts/prompt-eval.mts`,
  which imports the production `buildSystemPrompt`. A hand-copied prompt in
  the harness drifted once and measured phantom failures; never fork the
  prompt text into an eval. Two prompt rewrites shipped unmeasured, scored
  worse, and were reverted (refs #259): baseline before, rerun after, both
  numbers in the PR.
- Plain `npx tsx` scripts cannot import app modules that read
  `import.meta.env`; use vitest with `// @vitest-environment node` and
  stub `Platform.shouldUseProxy` false, or `lib/http.ts` rewrites absolute
  URLs to the dev proxy. Run vitest from `app/`, never the repo root (the
  root run resolves a different config and reports phantom failures).
- Qwen3 `/no_think` is a placebo on Ollama (hides the tag, still reasons);
  `reasoning_effort: "none"` on the /v1 endpoint is the real switch, sent
  only to confirmed-Ollama servers.
- Time windows use copy-interpret-compute (refs #265): the model copies
  the user's phrase verbatim, `window-interpreter.ts` maps it to fields,
  `resolveWindow` does arithmetic. Small models copy perfectly but fail
  direct field-filling; never regress to direct fills or app-side phrase
  regexes (deleted twice).
- Prompt classification rules teach dimensions (intent by subject), never
  instance lists; an instance-based triage misclassified every combination
  outside its examples, four times.

## CI runners

- The linux-arm64 job runs under qemu and needs Node 18 with a normalized
  manual-trigger input; do not bump that job's Node version without
  re-verifying under emulation (76fb8c0d, 57015c35).
