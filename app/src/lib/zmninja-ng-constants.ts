/**
 * zmNinjaNg Application Constants
 *
 * Centralized configuration values for the zmNinjaNg application.
 * Many values are derived from the original zmNinja application
 * to ensure consistent behavior and performance.
 *
 * For ZoneMinder protocol constants (commands, modes, etc.),
 * see zm-constants.ts
 */

/**
 * ZoneMinder Integration Constants
 *
 * Configuration values for interacting with ZoneMinder servers.
 * These are zmNinjaNg-specific settings, not ZM protocol values.
 */
export const API_REQUEST = {
  // Default per-request timeout (seconds) applied to REST API calls when the
  // caller doesn't set an explicit one. Overridable per profile via the
  // apiTimeoutSeconds setting; 0 disables the timeout. Caps how long a request
  // can hang (e.g. when the HTTP connection pool is saturated) so the UI can
  // error and retry instead of stalling forever.
  defaultTimeoutSeconds: 15,
  // Bounds for the user-facing setting (seconds).
  minTimeoutSeconds: 0,
  maxTimeoutSeconds: 120,
} as const;

/**
 * Maximum number of retries for a failed React Query query (the app-wide
 * default, equivalent to `retry: 1`). Auth errors (401/403) are never
 * retried; see shouldRetryQuery in stores/query-cache.ts.
 */
export const MAX_QUERY_RETRIES = 1;

/**
 * App-wide default React Query `staleTime` (ms). Keeps the last successful
 * response visible and "fresh" for this long instead of re-flagging it stale
 * (and re-fetching / erroring) the instant a component using it mounts or a
 * network blip hits. Queries with their own `refetchInterval` (monitor
 * status, etc.) still refetch on that schedule regardless; this only affects
 * queries relying on mount/reconnect-triggered refetches (states, groups,
 * tags, server info). Chosen shorter than the shortest bandwidth-mode
 * refetch interval (monitorStatusInterval, 20s in normal mode) so it never
 * masks a legitimate periodic refresh. refs #217
 */
export const DEFAULT_QUERY_STALE_TIME_MS = 15000;

export const ZM_INTEGRATION = {
  // HTTP timeouts for ZM API calls
  httpTimeout: 10000, // 10 seconds - standard API calls
  largeHttpTimeout: 30000, // 30 seconds - large responses (events, etc.)

  // Streaming and video performance
  defaultFps: 3, // Default FPS for event playback
  maxFps: 30, // Maximum FPS allowed
  streamMaxFps: 10, // Max FPS for live monitor streams (to reduce bandwidth)

  // Reconnect backoff for the MJPEG stream when the connection drops or ends
  // (server restart, network blip). Exponential from base, capped, with a
  // bounded attempt count before surfacing the stream-error state.
  mjpegReconnectBaseDelayMs: 1000, // 1 second
  mjpegReconnectMaxDelayMs: 15000, // 15 seconds
  mjpegReconnectMaxAttempts: 6,

  // Grace delay before a scheduled CMD_QUIT fires. Lets React StrictMode's
  // dev double-mount cancel the quit instead of killing a stream the
  // surviving mount is still using. See lib/zm/zms-quit.ts.
  cmdQuitGraceMs: 150,

  // Image quality settings
  safeImageQuality: 10, // Safe quality setting for bandwidth-constrained scenarios
  defaultMontageQuality: 50, // Default JPEG quality for montage view
  maxMontageQuality: 70, // Maximum quality for montage (balance quality/bandwidth)

  // Stream scale percentages
  montageStreamScale: 50, // Scale % for montage streams (reduces bandwidth)
  monitorStreamScale: 40, // Scale % for single monitor detail view

  // Image dimensions
  thumbWidth: 200, // Thumbnail width for event cards
  eventImageWidth: 320, // Event snapshot width
  eventImageHeight: 240, // Event snapshot height
  eventMontageImageWidth: 300, // Event montage tile width
  eventMontageImageHeight: 200, // Event montage tile height

  // Token management
  accessTokenLeewayMin: 5, // Minutes before token expiry to refresh
  refreshTokenLeewayMin: 10, // Minutes before refresh token expiry
  accessTokenLeewayMs: 30 * 60 * 1000, // 30 minutes in milliseconds. Gates URL construction; refresh fires when below this threshold
  tokenCheckInterval: 60 * 1000, // Check token status every minute
  loginInterval: 1800000, // 30 minutes - re-login interval
} as const;

/**
 * Auto-restart (desktop only): periodically relaunch the app to release WebKit's
 * process-level memory that no in-process flush reclaims. Interval is in minutes.
 */

/**
 * Grid Layout Constants
 *
 * Used by Dashboard and Montage views for responsive grid layouts.
 * Based on react-grid-layout configuration.
 */
export const GRID_LAYOUT = {
  // Grid columns (12-column system for responsive layout)
  cols: 12,

  // Row height in pixels (dashboard cards)
  rowHeight: 100,

  // Margin between grid items in pixels (dashboard)
  margin: 16,

  // Margin between montage grid items in pixels (tighter for monitor feeds)
  montageMargin: 4,

  // Minimum card width in grid units
  minCardWidth: 50,

  // Montage row height in pixels: 1px for pixel-level precision (no black bars with contain)
  montageRowHeight: 1,

  // Grid calculation frequencies
  montageScaleFrequency: 300, // How often to recalculate montage scales (ms)
  packeryTimer: 500, // Delay for packery layout recalculation (ms)
  resizeDebounceMs: 500, // Debounce window for ResizeObserver in montage container
} as const;

/**
 * Sidebar Navigation Constants
 *
 * Dimensions and behavior for the collapsible sidebar navigation.
 */
export const SIDEBAR_NAV = {
  // Minimum width when collapsed (icon-only mode)
  minWidth: 60,

  // Maximum width when expanded
  maxWidth: 256,

  // Default width on first load
  defaultWidth: 180,
} as const;

/**
 * Timeline Widget Constants
 *
 * Configuration for the timeline view zoom and display.
 */
export const TIMELINE = {
  // Minimum zoom level (1 minute)
  zoomMin: 60000,

  // Maximum zoom level (1 week)
  zoomMax: 7 * 24 * 60 * 60 * 1000,

  // Pulse halo duration (ms) for newly arrived live events
  pulseDurationMs: 5000,

  // Max events for a single (non-fanned-out) timeline query
  eventsLimit: 2000,

  // Per-monitor cap when a cause filter fans the query out across monitors,
  // so one busy camera can't consume the whole budget
  perMonitorEventsLimit: 100,

  // Max monitors queried in parallel during cause-filter fan-out
  fanoutConcurrency: 6,

  // Delay (ms) between a live notification arriving and the events refetch, so ZM can index the event
  liveRefetchDebounceMs: 2000,

  // Live-event arrival timestamps older than this (ms) are pruned
  liveArrivalTtlMs: 5000,
} as const;

/**
 * Notification Service Constants
 *
 * Configuration for the WebSocket notification service.
 */
export const NOTIFICATIONS_SERVICE = {
  // Default port for ZM notification server
  defaultPort: 9000,

  // Maximum events to keep in notification history
  maxEvents: 100,

  // Delay before attempting reconnection (ms)
  reconnectDelay: 5000,

  // Width (px) requested for event snapshot images in notifications
  snapshotImageWidth: 600,

  // Delay before the first ES-mode auto-connect attempt, to let profile/auth
  // store rehydration finish (ms)
  autoConnectInitDelayMs: 500,
} as const;

/**
 * Bootstrap and Initialization Timeouts
 *
 * Timeouts for profile initialization and server connection.
 */
export const BOOTSTRAP_TIMEOUTS = {
  // Timeout for each bootstrap step (auth, timezone, etc.)
  stepTimeoutMs: 8000,

  // Total timeout for entire bootstrap process
  totalTimeoutMs: 20000,

  // Fallback timeout for profile store initialization in App.tsx.
  // Forces isInitialized=true if rehydration hasn't completed in time.
  initFallbackMs: 5000,
} as const;

/**
 * API Pagination Limits
 *
 * Limits for paginated API responses to prevent excessive data fetching.
 */
export const API_PAGINATION = {
  // Maximum pages to fetch for events (prevents infinite loops)
  maxEventPages: 10,

  // Events per page (ZM API default)
  eventsPerPage: 100,

  // Total max events = maxEventPages * eventsPerPage = 1000

  // Max event IDs per "Id IN:" filter request. ZM's Apache caps the request
  // line near 8 KB; ~500 IDs (4.8 KB) was the verified ceiling on ZM 1.36, so
  // 200 leaves headroom for the token and other filter segments in the URL.
  eventIdFilterChunkSize: 200,
} as const;

/**
 * Recent-events list shown under the live view on the monitor detail page.
 * Count is a per-profile setting; these are its default and clamp bounds.
 */
export const MONITOR_DETAIL_RECENT_EVENTS = {
  defaultCount: 20,
  minCount: 1,
  maxCount: 50,
} as const;

/**
 * The app shell's single scroll container (AppLayout's <main>). Pages without
 * their own overflow container scroll this element, so scroll restoration for
 * those pages targets it.
 */
export const MAIN_SCROLL_SELECTOR = '[data-tv-region="main"]';

/**
 * How long to keep re-applying a restored scroll offset while a page's async
 * content is still growing (ms). Restoration stops early once the target is
 * reached or the user scrolls.
 */
export const SCROLL_RESTORE_MAX_MS = 1000;

/**
 * How long (ms) to flag the event row a user just returned from, with a blinking
 * arrow and a soft highlight, in the recent-events and main event lists.
 */
export const RETURN_FLASH_MS = 4000;

/**
 * Event List View Constants
 *
 * Configuration for the events list display.
 */
export const EVENT_LIST = {
  // Only virtualize lists larger than this threshold.
  // Smaller lists render directly to avoid scroll margin calculation complexity
  // when there's content above the list (header, heatmap, etc.)
  virtualizationThreshold: 100,
} as const;

/** How long the scrub bar waits after the last drag movement before seeking, so
 *  a continuous back-and-forth drag does not flood the ZMS stream. A seek also
 *  always fires on release (refs #196). */
export const EVENT_SCRUB_SEEK_DEBOUNCE_MS = 200;

/**
 * Delay before a settled ZMS seek is repeated to the same offset (refs #196).
 *
 * MJPEG in an <img> renders a multipart part only when the next part's boundary
 * begins to arrive, and a paused or idle zms only emits its next frame on the
 * MAX_STREAM_DELAY (5s) keepalive. So a lone seek to a stopped stream shows its
 * frame ~5s late. Newer zms fixes this server-side by sending the sought frame
 * twice; on older servers (ZM 1.36) we emulate that by repeating the seek so a
 * second frame flushes the first. The delay must exceed one zms loop tick so
 * the two seeks are not drained into a single frame send. 400ms clears the
 * paused tick for any event above ~2 fps while staying well under the 5s fallback.
 */
export const EVENT_SEEK_FLUSH_DELAY_MS = 400;

/**
 * Relative time labels on events (issue #210).
 * List chip only renders for events within this many days; older events read
 * fine from the absolute date. Below the just-now threshold we show "just now".
 */
export const RELATIVE_TIME_LIST_WINDOW_DAYS = 7;
export const RELATIVE_TIME_JUST_NOW_MS = 60_000;

/**
 * Development Proxy Server Configuration
 *
 * DEVELOPMENT ONLY: Used by the local proxy server for CORS bypass during development.
 * Not used in production builds.
 */
export const DEV_PROXY = {
  // Local proxy server port (only used in dev mode)
  port: 3001,

  // Mock notification server port (for testing without ZM)
  mockNotificationPort: 9000,
} as const;

/**
 * Monitor Status Color Mappings
 *
 * Color codes for monitor status indicators in the UI.
 */
export const MONITOR_STATUS_COLORS = {
  checking: '#03A9F4', // Blue - checking status
  notRunning: '#F44336', // Red - monitor not running
  pending: '#FF9800', // Orange - pending state
  running: '#4CAF50', // Green - running normally
  error: '#795548', // Brown - error state
} as const;

/**
 * Logging and Debugging Constants
 *
 * Configuration for application logging and debug output.
 */
export const LOGGING = {
  // Maximum log entries to retain in the logs screen
  maxLogEntries: 1000,
  // Maximum stack trace characters logged by the global error handlers
  maxStackLength: 4000,
} as const;

/**
 * Persistent Storage Keys
 *
 * Keys for localStorage / Capacitor Preferences entries owned by zmNinjaNg.
 * Centralized to prevent collisions and make migrations searchable.
 */
export const STORAGE_KEYS = {
  // UI section open/closed state
  hoverPreviewOpen: 'zmng-hover-preview-open',
  thumbnailChainOpen: 'zmng-thumbnail-chain-open',

  // Web crypto fallback salt (versioned: bump suffix to invalidate)
  cryptoSalt: 'zmng_crypto_salt_v1',

  // Developer Notice: per-device list of read notice IDs (versioned)
  developerNoticeRead: 'zmng_developer_notice_read_v1',

  // Developer Notice: per-device dismissed-critical-banner ids
  developerNoticeBannerDismissed: 'zmng_developer_notice_banner_dismissed_v1',

  // Persisted Zustand store keys. These strings are existing on-disk keys:
  // changing a value orphans every current user's persisted state, so the
  // historical (inconsistently namespaced) names are kept verbatim.
  authStore: 'zmng-auth',
  profilesStore: 'zmng-profiles',
  settingsStore: 'zmng-settings',
  notificationsStore: 'zmng-notifications',
  eventFavoritesStore: 'zmng-event-favorites',
  monitorSeenStore: 'zmng-monitor-seen',
  dashboardStore: 'dashboard-storage',
  monitorStore: 'zm-monitor-store',

  // Secure-storage key for the auth refresh token (Capacitor SecureStorage / web fallback)
  authRefreshToken: 'auth_refresh_token',

  // In-app assistant: dev-only flag to force a deterministic stub provider
  // instead of loading WebLLM (issue #246)
  assistantTestMode: 'zmng-assistant-test-mode',

  // Floating assistant window: persisted zustand store key (only the
  // resizable panel's width/height are persisted, see stores/assistantPanel.ts)
  assistantPanelStore: 'zmng-assistant-panel',
} as const;

/**
 * Developer Notice Feed
 *
 * One-way broadcast channel from the maintainer to all users. The app fetches
 * a static JSON feed from the repo (no backend, no telemetry). New notices
 * surface as a slow-pulsing dot in the sidebar and, when severity is
 * "critical", as a global dismissible banner. Per-device read state lives in
 * localStorage under STORAGE_KEYS.developerNoticeRead.
 */
export const DEVELOPER_NOTICES = {
  // Public raw URL of the notice feed (GitHub serves with ~5min CDN TTL)
  feedUrl: 'https://raw.githubusercontent.com/ZoneMinder/zmNinjaNg/main/docs/notices.json',

  // Background refetch interval. React Query handles the actual polling.
  // Notices change rarely, so poll once per day.
  pollIntervalMs: 24 * 60 * 60 * 1000,

  // How long fetched data stays "fresh" before a refetch is allowed. Matches the
  // poll interval so a window-focus refetch does not check more often than daily.
  staleTimeMs: 24 * 60 * 60 * 1000,
} as const;

/**
 * Background Tasks
 *
 * Limits for the in-memory background task store (downloads, exports).
 */
export const BACKGROUND_TASKS = {
  // Maximum completed/failed/cancelled tasks kept in the store. Oldest
  // terminal tasks beyond this are evicted so long-lived sessions (kiosk
  // mode, repeated downloads) do not grow memory without bound. Active
  // tasks are never evicted.
  maxRetainedTerminalTasks: 50,
} as const;

/**
 * UI Interaction Timings
 *
 * Pointer/touch timing knobs shared across hover previews, hold-to-repeat
 * buttons (zoom, PTZ), and long-press detection.
 */
export const UI_INTERACTIONS = {
  // Hold-to-repeat: delay before the first repeat fires (ms)
  holdInitialDelayMs: 400,

  // Hold-to-repeat: interval between repeats while held (ms)
  holdRepeatIntervalMs: 100,

  // PTZ hold-to-move repeat for non-continuous drivers (ms).
  // Tuned to keep the race window between a queued step and the
  // release-stop small while still feeling continuous.
  ptzHoldRepeatMs: 400,

  // Mouse hover delay before a preview opens (ms)
  hoverDelayMs: 700,

  // Touch long-press threshold for opening a preview (ms)
  longPressMs: 500,

  // Hover preview enter/exit animation duration (ms)
  previewAnimationMs: 200,

  // Default hover preview width (px)
  previewWidthPx: 400,

  // Hover preview minimum margin from viewport edges (px)
  previewEdgeMarginPx: 12,

  // Pointer movement threshold to cancel a long-press (px)
  moveCancelPx: 8,
} as const;

/**
 * Overlay Z-Index Layers
 *
 * Stacking contract for fullscreen overlays rendered above the app.
 * In-page elements use small Tailwind utilities (z-10, z-50); these
 * values are for portal or fixed overlays that must sit above all of
 * them. Backdrops sit one step below the content they belong to.
 */
export const Z_INDEX = {
  // Fullscreen blocking backdrops (hover preview backdrop, app init blocker)
  overlayBackdrop: 9998,

  // Overlay content above a backdrop (hover preview card, kiosk lock overlay)
  overlay: 9999,

  // Kiosk PIN pad: must sit above the kiosk lock overlay
  kioskPinPad: 10000,

  // TV mode cursor: above every other layer in this group
  tvCursor: 99999,
} as const;

/**
 * Notification Badge UI
 *
 * Visual feedback timing for the notification bell.
 */
export const NOTIFICATION_UI = {
  // Total ring animation duration after a new notification (ms).
  // Includes CSS animation plus a settle window.
  badgeRingDurationMs: 3500,
} as const;

/**
 * Monitor UI Visual Effects
 */
export const MONITOR_UI = {
  // Alarm pulse duration on a monitor tile after a new event (ms)
  alarmPulseMs: 6000,
} as const;

/**
 * Kiosk (Lock) Mode Constants
 *
 * PIN attempt and cooldown configuration for kiosk lock mode.
 */
export const KIOSK = {
  // Maximum failed PIN attempts before cooldown engages
  maxPinAttempts: 5,

  // Cooldown duration after exceeding max attempts (ms)
  cooldownMs: 30_000,

  // How often the kiosk overlay's cooldown countdown re-renders (ms)
  cooldownTickIntervalMs: 1000,

  // Delay between the 4th PIN digit being entered and auto-submit, so the
  // filled-in last digit is visible before the pad reacts (ms)
  pinAutoSubmitDelayMs: 100,
} as const;

/**
 * Android hardware back button.
 */
export const ANDROID_BACK = {
  // At a root view, a second back press within this window exits the app.
  exitConfirmWindowMs: 2000,
} as const;

/**
 * Global keyboard shortcuts.
 */
export const KEYBOARD_SHORTCUTS = {
  // Idle delay before a typed monitor number commits and navigates.
  monitorJumpCommitMs: 1000,
  // Cap on digits buffered for the monitor jump.
  maxMonitorDigits: 4,
} as const;

/**
 * In-app assistant (Ask). Model runs on-device via WebGPU. Issue #246.
 * webllmModels ids are the exact WebLLM prebuilt registry ids, fixed in Phase 2.
 */
export const ASSISTANT = {
  maxToolIterations: 6,
  maxHistoryMessages: 40,
  maxTokens: 1024,
  // web-llm's prebuilt registry entries cap context_window_size at 4096 for
  // every model (ModelRecord.overrides in @mlc-ai/web-llm's prebuiltAppConfig;
  // all 165 entries are 4096 or lower), well under what the models support
  // natively. Our prompt (system rules + few-shot + tool schemas + monitor
  // table + history + tool results) plus the generated output can exceed 4096,
  // throwing ContextWindowSizeExceededError, so each model below carries its
  // own `contextWindowSize`, passed as a ChatOptions override to
  // CreateMLCEngine's third argument (see model-download.ts createEngineOnce)
  // and merged in AFTER the prebuilt cap.
  //
  // Each value is min(the model's native window, contextWindowCap). NOT the
  // native window: the KV cache is allocated up front and grows linearly with
  // this number, on top of the weights, so Llama 3.2's native 128K would need
  // GBs of VRAM by itself and OOM on any phone. The cap is the ceiling that
  // keeps that bounded; a model whose native window is lower (Gemma 2: 8192)
  // gets its native value instead, since asking for more than a model was
  // trained for degrades output rather than helping.
  contextWindowCap: 16384,
  // Fraction of a turn's context window that, once the prompt exceeds it,
  // triggers the auto-clear notice in AskPanel. Below 1.0 by enough to fit the
  // NEXT turn's answer (maxTokens) plus its tool results: clearing only once
  // the window is already full means the turn that discovers it has already
  // failed.
  contextClearThreshold: 0.75,

  maxListEventsLimit: 25,
  requestTimeoutMs: 120000,
  // A "Test connection" click only needs to know the server answers, not run a
  // full chat turn: `requestTimeoutMs` (120s) covers the WORST case (a slow
  // local model actually generating), so reusing it here left the button
  // reading "Testing…" for up to two minutes against an unreachable host. This
  // is a plain reachability probe (AssistantOllamaSection.tsx's
  // handleTestConnection), so it gets its own short budget.
  testConnectionTimeoutMs: 8000,
  systemPromptMonitorCap: 50,
  // Max characters of an event's Notes field kept in a list_events row (rule
  // 11: truncate long text); get_event still returns the full Notes.
  notesPreviewChars: 200,
  // Max characters of a tool call's JSON-stringified input shown inline next
  // to an activity step in AskPanel (rule 11: truncate long text).
  activityInputPreviewChars: 40,
  defaultModelId: 'Qwen3-1.7B-q4f16_1-MLC',
  // Ordered smallest first: the top of the picker is the safest thing to load
  // on a phone, and `approxSizeMb` is web-llm's own `vram_required_MB` for the
  // record (measured at ITS 4096 window, so the real figure at the
  // `contextWindowSize` below is higher; treat it as a floor, not a budget).
  // `Qwen2.5-3B-Instruct-q4f16_1-MLC` was dropped here in favour of Qwen3;
  // migrateSettings (stores/settings.ts) rewrites saved copies of that id.
  // Each `contextWindowSize` is min(the model's native window, contextWindowCap),
  // where "native" is the model's real trained limit, NOT the value in its
  // mlc-chat-config.json (MLC ships conservative defaults there: Llama 3.2's
  // config says 131072, Gemma 2's says 4096). Values cross-checked against the
  // configs at huggingface.co/mlc-ai/<id>/resolve/main/mlc-chat-config.json,
  // which is also the only place `sliding_window_size` appears (rule 41).
  // `gemma3-1b-it-q4f16_1-MLC` is deliberately absent: it does not work on
  // web-llm 0.2.84 in any configuration, verified on device. Its config ships
  // `sliding_window_size: 512` (the only model here that does), which makes the
  // stock registry entry unloadable at all (registry ctx 4096 + config slide
  // 512 => both positive => WindowSizeConfigurationError). Pinning
  // `sliding_window_size: -1` loads it, but forces full-KV attention on a wasm
  // compiled for sliding-window attention: it then answered empty at ctx 16384
  // and emitted token soup ("//\n$$ }}!!\n'''\nperlport's...") at ctx 8192.
  // Its own 512-token window is the only untried mode and is far smaller than
  // this app's system prompt, so the model would never see the tool contract.
  // Do not re-add without checking a newer web-llm first.
  webllmModels: [
    { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B', approxSizeMb: 879, contextWindowSize: 16384 },
    // 8192 is Gemma 2's real native window; its config's 4096 is an MLC
    // default, and 4096 is not enough for this app's prompt. Also the only
    // model here declaring `required_features: ['shader-f16']`, so it can fail
    // to load on a device where the others work.
    { id: 'gemma-2-2b-it-q4f16_1-MLC', label: 'Gemma 2 2B', approxSizeMb: 1895, contextWindowSize: 8192 },
    { id: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 1.7B', approxSizeMb: 2037, contextWindowSize: 16384 },
    { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B', approxSizeMb: 2264, contextWindowSize: 16384 },
  ],
  /** Saved `assistantModelId` values no longer in `webllmModels`, mapped to
   *  their replacement. Consumed by migrateSettings (stores/settings.ts).
   *  Adding an entry here means bumping the settings store's persist `version`,
   *  or the rewrite never runs for anyone already on the current version. */
  retiredModelIds: {
    'Qwen2.5-3B-Instruct-q4f16_1-MLC': 'Qwen3-1.7B-q4f16_1-MLC',
    // Broken on web-llm 0.2.84 (see the note above webllmModels). Llama 3.2 1B
    // is the nearest replacement: the smallest model that works.
    'gemma3-1b-it-q4f16_1-MLC': 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  } as Record<string, string>,
  // Ollama's default local HTTP address, OpenAI-compatible endpoint (refs #246).
  // On a phone this must be replaced with the Ollama server's LAN address:
  // "localhost" from the app's own process never reaches a server on another
  // host, and (on native) not even the desktop this profile was created on.
  defaultOllamaBaseUrl: 'http://localhost:11434/v1',
  // Prefix for the secure-storage key holding the optional Ollama/OpenAI
  // Bearer API key, suffixed with the profile id (lib/security/secureStorage.ts).
  // Never held in profile settings (rule 7 settings are plaintext-persisted).
  apiKeyStoragePrefix: 'assistant-api-key-',
  // Ninjii's logo (refs #246), served from the web root (app/public/ninjii.png).
  // Shared by the widget header, the minimized FAB, and AskPanel's empty-thread
  // self-introduction, so the asset path has one source of truth.
  logoPath: '/ninjii.png',
} as const;

/**
 * Floating assistant window (refs #246).
 *
 * Desktop is a resizable floating panel anchored bottom-right; native CSS
 * `resize` (no hand-rolled drag math) lets the user drag the corner, and an
 * attached ResizeObserver debounces the observed size into
 * `stores/assistantPanel.ts`. Mobile ignores all of this and renders a
 * full-screen sheet instead (components/assistant/AssistantWidget.tsx).
 */
export const ASSISTANT_PANEL = {
  defaultWidth: 400,
  defaultHeight: 560,
  minWidth: 320,
  minHeight: 400,
  maxWidth: 720,
  maxHeight: 960,
  // Debounce window before a CSS-resize drag is written to the persisted
  // store; ResizeObserver fires on every intermediate frame while dragging.
  resizeDebounceMs: 300,
  // Must match Tailwind's default `sm` breakpoint (tailwind.config.js does not
  // override it): the ResizeObserver callback uses this to ignore viewport
  // resizes on the mobile full-screen sheet, which never persists a size.
  mobileBreakpointPx: 640,
} as const;

/**
 * Monitor Detail Navigation
 *
 * Swipe/prev-next navigation between monitors on the monitor detail page.
 */
export const MONITOR_NAVIGATION = {
  // How long the slide-transition state stays active after switching monitors,
  // matching the CSS slide animation duration (ms)
  slideAnimationMs: 450,
} as const;

/**
 * Montage Grid Constants
 *
 * Internal grid sizing for the Montage view.
 */
export const MONTAGE_GRID = {
  // Sub-units per display column. The internal react-grid-layout grid spans
  // (displayColumns * colSubdivision) units, so any column count renders
  // exactly, while tiles still resize in fractions of a column.
  colSubdivision: 12,

  // h-8 header bar height with monitor name + buttons (px)
  cardHeaderHeightPx: 32,
} as const;

/**
 * Go2RTC Live Streaming Constants
 *
 * Timing for the go2rtc (MSE/WebRTC) live stream path used by the live monitor
 * player and montage tiles.
 */

/**
 * Seconds to wait for decoded video frames after go2rtc reports "connected"
 * before giving up and falling back to MJPEG. In montage every tile connects
 * at once, so this is generous enough to cover the resulting burst.
 */
export const GO2RTC_VIDEO_TIMEOUT_S = 15;

/** Base delay before connecting, to survive React Strict Mode double-invoke (ms) */
export const GO2RTC_CONNECT_DELAY_MS = 100;

/**
 * How often to poll the go2rtc <video> for decoded frames while the MJPEG-first
 * placeholder is showing, so the player swaps to MSE as soon as frames arrive
 * instead of waiting for the full GO2RTC_VIDEO_TIMEOUT_S deadline.
 */
export const GO2RTC_FRAME_POLL_MS = 250;

/** How often to check a playing MSE stream for freeze after the first frame (ms) */
export const GO2RTC_LIVENESS_CHECK_MS = 3000;

/** Seconds of no video.currentTime advance (or stuck readyState) before treating an MSE stream as frozen */
export const GO2RTC_FREEZE_THRESHOLD_S = 7;

/** Freeze recoveries (retries) per monitor before giving up on MSE and falling back to MJPEG */
export const GO2RTC_MAX_FREEZE_RETRIES = 2;

/** Seconds an MSE stream must advance healthily before the freeze-retry counter resets */
export const GO2RTC_FREEZE_RESET_S = 60;

/** Minutes before retrying go2rtc on a monitor that previously failed */
export const GO2RTC_RETRY_INTERVAL_MIN = 5;

/**
 * STUN servers applied to the browser-side go2rtc RTCPeerConnection when the
 * per-profile `webrtcUseStun` setting is on. These mirror the servers
 * video-rtc.js hardcodes. STUN is only needed to reach go2rtc directly across
 * the public internet without a portal/VPN, where NAT traversal needs a
 * server-reflexive candidate.
 *
 * When the setting is off (the default), useGo2RTCStream applies an empty ICE
 * list instead. On a LAN (and via a portal/VPN reverse proxy) the pc connects on
 * host candidates, so STUN is never on the path. An empty list also stops
 * Chromium from starting a STUN hostname lookup that it would cancel when
 * video-rtc tears the pc down (WebRTC/MSE race, or tile rotation), which
 * otherwise logs "Failed to resolve address for stun... errorcode: -105" even
 * though DNS resolves fine.
 */
export const GO2RTC_STUN_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
];

/**
 * Downloads
 *
 * Timing for browser-triggered file downloads (web platform).
 */
export const DOWNLOAD = {
  // Delay before removing the temporary anchor element used to trigger a
  // data-URL download, so the browser has time to start the download (ms)
  webLinkCleanupDelayMs: 100,
} as const;

/**
 * Discovery Timeouts
 *
 * Network discovery retries and platform permission delays.
 */
export const DISCOVERY_TIMEOUTS = {
  // Retry delay after first discovery failure to wait for the iOS local
  // network permission dialog. The first request fails while the dialog
  // is showing, but succeeds after the user grants access.
  iosPermissionRetryMs: 3000,
} as const;

/**
 * Bandwidth Mode Types
 */
export type BandwidthMode = 'normal' | 'low';

/**
 * Bandwidth Settings Interface
 */
export interface BandwidthSettings {
  /** Monitor status polling interval (ms) */
  monitorStatusInterval: number;
  /** Alarm status polling interval (ms) */
  alarmStatusInterval: number;
  /** Snapshot refresh interval (seconds) */
  snapshotRefreshInterval: number;
  /** Events widget polling interval (ms) */
  eventsWidgetInterval: number;
  /** Timeline/Heatmap widget polling interval (ms) */
  timelineHeatmapInterval: number;
  /** Monitor new events polling interval (ms) */
  monitorNewEventsInterval: number;
  /** Daemon check polling interval (ms) */
  daemonCheckInterval: number;
  /** Image scale percentage (1-100) */
  imageScale: number;
  /** Image quality percentage (1-100) */
  imageQuality: number;
  /** Stream max FPS */
  streamMaxFps: number;
  /** ZMS playback status polling interval (ms) */
  zmsStatusInterval: number;
  /** Event poller interval for direct notification mode (ms) */
  eventPollerInterval: number;
  /** WebSocket keepalive ping interval (ms) */
  wsKeepaliveInterval: number;
  /** Timeline now-line refresh interval (ms) */
  timelineNowRefreshInterval: number;
  /** Monitor-detail recent-events list polling interval (ms) */
  monitorRecentEventsInterval: number;
}

/**
 * Bandwidth Settings by Mode
 *
 * Configurable polling intervals and image quality settings
 * to balance between responsiveness and bandwidth usage.
 */
export const BANDWIDTH_SETTINGS: Record<BandwidthMode, BandwidthSettings> = {
  normal: {
    monitorStatusInterval: 20000, // 20 sec
    alarmStatusInterval: 5000, // 5 sec
    snapshotRefreshInterval: 3, // 3 sec (stored in seconds for settings compatibility)
    eventsWidgetInterval: 30000, // 30 sec
    timelineHeatmapInterval: 60000, // 60 sec
    monitorNewEventsInterval: 60000, // 60 sec
    daemonCheckInterval: 30000, // 30 sec
    imageScale: 100, // 100%
    imageQuality: 100, // 100%
    streamMaxFps: 10, // 10 FPS
    zmsStatusInterval: 3000, // 3 sec
    eventPollerInterval: 30000, // 30 sec
    wsKeepaliveInterval: 60000, // 60 sec
    timelineNowRefreshInterval: 30000, // 30 sec
    monitorRecentEventsInterval: 30000, // 30 sec
  },
  low: {
    monitorStatusInterval: 40000, // 40 sec
    alarmStatusInterval: 10000, // 10 sec
    snapshotRefreshInterval: 10, // 10 sec
    eventsWidgetInterval: 60000, // 60 sec
    timelineHeatmapInterval: 120000, // 120 sec
    monitorNewEventsInterval: 120000, // 120 sec
    daemonCheckInterval: 60000, // 60 sec
    imageScale: 50, // 50%
    imageQuality: 50, // 50%
    streamMaxFps: 5, // 5 FPS
    zmsStatusInterval: 5000, // 5 sec
    eventPollerInterval: 60000, // 60 sec (2x slower)
    wsKeepaliveInterval: 120000, // 120 sec (2x slower)
    timelineNowRefreshInterval: 60000, // 60 sec (2x slower)
    monitorRecentEventsInterval: 60000, // 60 sec
  },
} as const;

/**
 * Get bandwidth settings for a given mode
 */
export function getBandwidthSettings(mode: BandwidthMode): BandwidthSettings {
  return BANDWIDTH_SETTINGS[mode];
}
