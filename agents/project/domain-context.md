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
- `monitors.json` returns the full monitor row to any account that can view
  the monitor: `Path`, `User`, `Pass`, `ONVIF_Password`, `Options`. There is
  no per-field ACL, so an unprivileged account reads every camera's
  credentials straight from the API. Nothing app-side can prevent that; the
  app's job is to not widen it by logging or displaying those values
  (refs #307).
- A camera password lives inside `Path` as URL userinfo
  (`rtsp://user:pass@host/stream`), and pre-1.38 servers have no other field
  for it. `lib/security/url-credentials.ts` is the only place that knows how
  to find it; both the log sanitizer and the monitor settings UI go through
  it.
- Alarm state (`monitors/alarm/id:{id}/command:status`) comes from the motion
  score alone, never from recording mode. A `Recording=Always` monitor with an
  open `cause: Continuous` event still reports `0` (IDLE), verified against
  1.39.18; it reports ALARM/ALERT on motion like any other monitor. `TAPE` (4)
  existed only before its removal in 1.37 dev, where a continuous recorder sat
  in it while quiet. So "always recording" never means "always alarming", and
  `isAlarmingState` covers the legacy case already.
- Event Server v7.0.22 and later always sends a real `eid` in pushes. The
  historical fake-eid bug (a `Date.now()` value where an event id belongs)
  was app-side tray handling, not the ES.

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
- `zms` exits mid-event when it cannot serve a frame, after painting the
  reason ("Failed getting frame") into the MJPEG stream as its last frame.
  The `<img>` shows no error for that: it keeps the frame forever. The only
  client-side signal is the status query, which a connkey with no process
  behind it answers without `progress`/`duration`. Monitors that store video
  without JPEGs hit this most, since `zms` then has to decode the video.
- `zms` answers 503 once its streaming daemon is saturated, and a profile
  switch is when that happens: the outgoing profile's quits are awaited but
  their replies time out at 3s (`cmdQuitTimeoutSeconds`), so the incoming
  profile opens a screenful of streams while the old processes still hold
  slots. They free within seconds, so a young stream retries on a flat quick
  interval that does not spend its give-up budget
  (`lib/monitor/reconnect-backoff.ts`); climbing the ordinary exponential
  curve through that window left a wall of tiles blank for ~20s.
- Electron background/occlusion process switches do not fix MJPEG going
  blank on occluded windows; tried and reverted (69990402). The fix is
  stream-level reconnect on focus or visibility return (f7a8292e).
- A minted connkey is not a frame. Gate an `<img>`'s visibility on a `load`
  for the src it currently holds, never on the URL existing: the element
  keeps a dead stream's last frame (which may be half written) with no error
  event, and on a mobile resume WebKit re-fetches images it evicted while
  backgrounded against connkeys that are now dead, painting its broken-image
  glyph before any error event lands. Alt text on a stream image is what the
  browser draws beside that glyph, so keep it empty (#352).
- `visibilitychange` alone is not a reliable resume signal on native: the
  WebView suspends with the app and is not obliged to report an app state
  change as a visibility change. Pair it with Capacitor `appStateChange`.
  Notifications learned this in #274 and streams re-learned it in #352.
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
- `react-grid-layout` clones every child with `ref: this.elementRef`, which
  REPLACES a ref put on that element. Anything needing a tile's DOM node
  (IntersectionObserver, measurement) puts its ref one level in, and any
  test mock of the grid clones with a ref too, or it calls refs the real
  grid swallows (c8d0d833).
- A ref-callback cache keyed by id must outlive a detach. Deleting the
  entry when React calls the ref with null hands the next render a
  different callback, which React treats as a new ref: detach, delete,
  re-attach, forever. StrictMode's own attach/detach/attach on mount
  starts it (c8d0d833).

## Auth and tokens

- Dedupe, no-credentials-in-URLs, and secure-storage rules live in the
  Auth tokens contract. Incidents behind them: independent refresh
  triggers double-POSTed and the second 401ed the rotated token,
  force-logging the user out (26b9e6a9, 19fb60e1); a refresh token in
  `?token=` leaked into server logs (e1393724); plaintext fallback on
  secure-store failure became drop-and-re-auth (a2cc647d). Web at-rest
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

Model choice, backends, reasoning switches, measured behavior patterns,
and the eval harness live in `agents/project/llm-models.md`; tool-loop
conduct (grounding, error feedback) lives in the Assistant tool loop
contract. Remaining code-path facts:

- Tool-call markup the parser does not recognize (Hermes XML, bare
  name/arguments JSON) is a parse failure that triggers self-repair retry;
  it never renders verbatim as the chat answer (2e28e5fc).
- Regex "call a tool" nudges are English-only by construction; gate them on
  `ToolContext.locale` and give other locales a language-neutral reminder
  (e74bcb84).
- Time windows use copy-interpret-compute (refs #265): the model copies
  the user's phrase verbatim, `window-interpreter.ts` maps it to fields,
  `resolveWindow` does arithmetic. Never regress to direct fills or
  app-side phrase regexes (deleted twice); the measured why lives in
  `llm-models.md`.

## CI runners

- The linux-arm64 job runs under qemu and needs Node 18 with a normalized
  manual-trigger input; do not bump that job's Node version without
  re-verifying under emulation (76fb8c0d, 57015c35).

## All-profiles facts (refs #337)

- ZoneMinder's alarm-status endpoint is single-monitor only (no batch
  form): live alarm views fan one query per monitor, so aggregate
  surfaces must cap and stagger the watched set (see the Aggregation
  contract and `LIVE_ACTIVITY.allModeMaxWatched`).
- Monitor and event ids collide across servers as a matter of course;
  any aggregate-keyed state needs `monitorCacheKey` composites. Six
  separate defects came from bare ids before this was standard.
- ES notification payloads carry a profile NAME only when the
  registration set one; ZM direct-mode payloads never carry one. All-mode
  tap handling must tolerate profile-less payloads (falls back to the
  ES-connected profile).
- Multi-server ZM installs route streams at Servers-table hosts that can
  differ from the profile's own URLs; per-profile server maps populate at
  bootstrap and fall back to profile base URLs when empty. This is also
  why native TLS trust is deliberately global once any profile enables
  self-signed (maintainer decision recorded in the all-profiles spec).
- i18next reserves `{{count}}` for pluralization; interpolating a
  non-plural number under that name works only by fallback and breaks
  silently if a locale later adds `_other` forms. A blanket sed over
  locale files once broke 15 pluralized strings - edit locale keys
  individually.
- The shared live ZM demo server degrades under repeated same-day
  parallel e2e runs (filter-popover timeouts, drifting counts). Five
  events-filter scenarios are bisect-proven pre-existing failures
  tracked in #342; treat new failures against that baseline, not zero.
