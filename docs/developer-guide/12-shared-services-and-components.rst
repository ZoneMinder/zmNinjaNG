Shared Services and Reusable Components
=======================================

Shared utilities, services, and reusable components in zmNinjaNg, with
their consumers.

Shared Services (lib/)
----------------------

The ``lib/`` directory contains platform-agnostic utilities.

Logger (``lib/logger.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~

Structured logging system with sanitization and component-specific
helpers.

**Features:**

- Log levels: DEBUG, INFO, WARN, ERROR, NONE
- Automatic sanitization of passwords, tokens, and sensitive data
- Component-specific logger methods (e.g., ``log.api()``,
  ``log.profile()``, ``log.download()``)
- Centralized log storage for debug UI (``/logs`` page)

**Implementation:**

.. code:: typescript

   import { log, LogLevel } from '../lib/logger';

   // Basic logging
   log.info('User logged in', { username: 'john' });
   log.error('Failed to fetch', { endpoint: '/api/monitors' }, error);

   // Component-specific (preferred)
   log.api('Fetching monitors', LogLevel.INFO, { endpoint: '/monitors.json' });
   log.download('Download started', LogLevel.INFO, { filename: 'video.mp4' });
   log.profileService('Switching profile', LogLevel.INFO, { from: 'A', to: 'B' });

**Available Component Loggers:**

- ``api``, ``app``, ``auth``, ``crypto``, ``dashboard``, ``discovery``,
  ``download``
- ``errorBoundary``, ``eventCard``, ``eventDetail``, ``eventMontage``
- ``http``, ``imageError``, ``kiosk``, ``monitor``, ``monitorCard``,
  ``monitorDetail``, ``montageMonitor``
- ``navigation``, ``notificationHandler``, ``notifications``,
  ``notificationSettings``
- ``profile``, ``profileForm``, ``profileService``, ``profileSwitcher``
- ``push``, ``queryCache``, ``secureImage``, ``secureStorage``,
  ``server``, ``sslTrust``, ``time``, ``timeline``
- ``videoMarkers``, ``videoPlayer``, ``zmsEventPlayer``

The list is the source of truth in ``app/src/lib/logger.ts``
(``componentLoggers`` array). Adding a new logger means appending to
that array and to the matching ``Logger`` class field.

**Used By:** Entire application (all components, stores, API functions)

--------------

Global Error Sinks (``lib/global-error-handlers.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Window-level listeners for ``unhandledrejection`` and ``error`` that route
async failures outside React Query and try/catch into the logger, so they
appear on the Logs page and in exported log files. ``main.tsx`` calls
``installGlobalErrorHandlers()`` once before React renders. The listeners
log via ``log.app()`` at ``LogLevel.ERROR`` with the rejection reason or
error message, source location, and stack, truncated to
``LOGGING.maxStackLength`` characters (4000). They never call
``preventDefault``, so browser console reporting is unchanged.
``uninstallGlobalErrorHandlers()`` removes the listeners; tests use it.

**Used By:** ``main.tsx`` (startup)

--------------

HTTP Client (``lib/http.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Platform-agnostic HTTP request abstraction that works on Web, iOS,
Android, and Desktop.

``lib/http.ts`` is the public facade and the only import path consumers
use. It builds the final URL, dispatches to a platform adapter, validates
the status, and logs the request. The internals live in ``lib/http/``:
``types.ts`` (request/response/error shapes), ``encoding.ts`` (body
serialization, base64/byte conversion), ``timeout.ts`` (abort-signal
composition, native timeout race), ``logging.ts`` (request IDs,
correlation tags), and one adapter per platform (``adapter-native.ts``,
``adapter-electron.ts``, ``adapter-web.ts``).

**Features:**

- Automatic platform detection (Capacitor, Electron, or Web)
- CORS handling via proxy in development
- Request/response logging via logger
- Token injection for authentication
- Support for multiple response types (json, blob, arraybuffer, text)

**Implementation:**

.. code:: typescript

   import { httpGet, httpPost, httpPut, httpDelete } from '../lib/http';

   // GET request
   const data = await httpGet<MonitorsResponse>('/api/monitors.json');

   // POST with body
   await httpPost('/api/states/change.json', {
     monitorId: '1',
     newState: 'Alert'
   });

   // With auth token
   await httpGet('/api/events.json', {
     token: accessToken,
     params: { limit: 50 }
   });

   // Blob response (for downloads)
   const blob = await httpGet<Blob>('/video.mp4', {
     responseType: 'blob'
   });

**Platform Implementations:**

- **Web**: Uses ``fetch()`` with standard CORS handling
- **Mobile (Capacitor)**: Uses ``CapacitorHttp`` for native networking
- **Desktop (Electron)**: Bridges the request over IPC
  (``electron/preload.cjs``) to the main process, which performs it with
  Electron's ``net`` module, avoiding renderer CORS

**SSL Trust:** On mobile, the native Capacitor plugin handles SSL trust
(see SSL Trust section below). On Electron desktop, the user must add
the CA to the system trust store.

**Used By:** API functions (``api/``), download utilities, all network
requests

--------------

SSL Trust (``lib/ssl-trust.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Controls whether the app accepts self-signed/untrusted HTTPS certificates
using TOFU (Trust On First Use) certificate pinning. The setting is
profile-scoped (``allowSelfSignedCerts`` + ``trustedCertFingerprint`` in
``ProfileSettings``) and disabled by default.

**TOFU Flow:**

1. User enables self-signed certs and connects to a server
2. App fetches the server's TLS certificate via ``getServerCertFingerprint()``
3. A dialog (``CertTrustDialog``) shows the cert's SHA-256 fingerprint
4. If the user accepts, the fingerprint is stored in
   ``ProfileSettings.trustedCertFingerprint``
5. All subsequent connections validate the server cert against the stored
   fingerprint, mismatches are rejected

**Platform Implementations:**

- **Mobile (iOS/Android)**: Uses a custom Capacitor plugin (``SSLTrust``)
  registered in ``src/plugins/ssl-trust/``. On Android,
  ``onReceivedSslError`` extracts the cert via ``SslCertificate.saveState()``,
  computes SHA-256, and calls ``proceed()`` only on fingerprint match, never
  without validation. The WebView handler is only installed when a fingerprint
  is set (via ``setTrustedFingerprint()``). HTTP requests use a
  ``TrustManager`` that validates fingerprints. On iOS, both ``URLProtocol``
  and ``WKNavigationDelegate`` validate cert fingerprints via CommonCrypto
  SHA-256.
- **Desktop (Electron) and Web**: No-op (Chromium enforces certificate
  validation). Users must add the CA to the system trust store.

**Plugin Methods:**

- ``enable()`` / ``disable()``: activate/deactivate the TrustManager
  (HTTP requests). Does not install the WebView handler.
- ``setTrustedFingerprint({ fingerprint })``: pass the pinned fingerprint.
  Installs the WebView SSL handler only when fingerprint is non-null.
- ``getServerCertFingerprint({ url })``: fetches the server's leaf
  certificate and returns its SHA-256 fingerprint, subject, issuer, and
  expiry.

**Implementation:**

.. code:: typescript

   import { applySSLTrustSetting, getServerCertFingerprint } from '../lib/ssl-trust';

   // Enable with fingerprint (normal operation)
   await applySSLTrustSetting(true, storedFingerprint);

   // Fetch cert for TOFU dialog
   const certInfo = await getServerCertFingerprint('https://zm.example.com');
   // certInfo.fingerprint = "AB:CD:12:..."

   // Enable trust-all for HTTP only (no WebView handler, used during cert fetch)
   await applySSLTrustSetting(true);

**Bootstrap Order:** ``bootstrapSSLTrust()`` in ``stores/profile-bootstrap.ts``
runs before ``bootstrapAuth()``. If ``allowSelfSignedCerts`` is true but
``trustedCertFingerprint`` is null (upgrade migration), it fetches the cert
and signals the UI via ``lib/cert-trust-event.ts`` to show the trust dialog
in ``AppLayout``.

**Key Files:**

- ``lib/ssl-trust.ts``: JS interface
- ``lib/cert-trust-event.ts``: event bridge for bootstrap-to-UI TOFU dialog
- ``plugins/ssl-trust/``: Capacitor plugin definitions
- ``components/CertTrustDialog.tsx``: trust dialog component
- ``android/.../SSLTrustPlugin.java``: Android native implementation
- ``ios/.../SSLTrustPlugin.swift``: iOS native implementation

**Used By:** ``stores/profile-bootstrap.ts``, ``pages/ProfileForm.tsx``,
``components/settings/ConnectionSettings.tsx``,
``components/layout/AppLayout.tsx`` (migration dialog)

--------------

Discovery (``services/discovery.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

ZoneMinder server discovery utility that probes for API endpoints and
derives connection URLs.

**Features:**

- Automatic HTTPS/HTTP fallback for scheme-less URLs
- Probes ``/zm/api`` and ``/api`` paths to find API endpoint
- Derives ``portalUrl`` and ``cgiUrl`` from confirmed API location
- Optional authentication to fetch accurate ``ZM_PATH_ZMS`` from server
  config
- Cancellable via AbortSignal
- Skips redundant probes on connection errors (faster failure)

**Implementation:**

.. code:: typescript

   import { discoverZoneminder, DiscoveryError } from '../services/discovery';

   // Basic discovery (no auth)
   const result = await discoverZoneminder('192.168.1.100');
   // Returns: { portalUrl, apiUrl, cgiUrl }

   // With credentials (fetches accurate ZMS path from server)
   const result = await discoverZoneminder('myserver.com', {
     username: 'admin',
     password: 'secret'
   });

   // With cancellation support
   const abortController = new AbortController();
   try {
     const result = await discoverZoneminder('192.168.1.100', {
       signal: abortController.signal
     });
   } catch (error) {
     if (error instanceof DiscoveryError && error.code === 'CANCELLED') {
       console.log('Discovery was cancelled');
     }
   }

   // Cancel from elsewhere
   abortController.abort();

**Error Codes:**

- ``API_NOT_FOUND`` - No ZoneMinder API found at any probed path
- ``PORTAL_UNREACHABLE`` - Server completely unreachable
- ``CANCELLED`` - Discovery was cancelled via AbortSignal
- ``UNKNOWN`` - Unexpected error

A higher-level wrapper, ``discoverUrls``, bundles the common call pattern
with iOS retry logic and an abort signal, so neither ``ProfileForm`` nor
``Profiles`` need to duplicate that handling:

.. code:: typescript

   import { discoverUrls } from '../services/discovery';

   // Shared wrapper with iOS retry logic and abort signal
   const result = await discoverUrls(portalUrl, {
     credentials: { username, password },
     signal: abortController.signal,
     onClientCreated: (client) => setApiClient(client),
   });
   // Returns: { portalUrl, apiUrl, cgiUrl }

**Used By:** ``ProfileForm.tsx``, ``Profiles.tsx`` (both call
``discoverUrls`` for profile creation/editing)

--------------

Download Utilities (``services/download.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Cross-platform file download with progress tracking and cancellation
support.

**Features:**

- Platform-specific implementations (Web, Mobile, Desktop)
- Progress callbacks for UI updates
- Cancellation via AbortSignal
- Automatic file saving to appropriate locations
- Mobile: Saves to Documents + Photo/Video library
- Desktop: User selects save location
- Web: Browser download

**Implementation:**

.. code:: typescript

   import { downloadFile, downloadSnapshot } from '../services/download';

   // Download a file with progress
   const abortController = new AbortController();

   await downloadFile('https://example.com/video.mp4', 'event-123.mp4', {
     signal: abortController.signal,
     onProgress: (progress) => {
       console.log(`${progress.percentage}% - ${progress.loaded}/${progress.total} bytes`);
     },
   });

   // Cancel download
   abortController.abort();

   // Download monitor snapshot
   await downloadSnapshot(imageUrl, monitorName);

**Platform Implementations:**

- **Web**: Blob + anchor download
- **Mobile**: CapacitorHttp, Filesystem, then Media library
- **Desktop (Electron)**: Chromium download to user-selected path

**Note:** Mobile uses base64 directly (not Blob conversion) to avoid
out-of-memory errors on large video files.

**Used By:** MonitorCard, EventDetail, EventCard, VideoPlayer

--------------

Proxy URL Utilities (``lib/proxy-utils.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Utilities for wrapping URLs with development proxy to handle CORS.

**Features:**

- Automatically wraps external URLs with proxy in development mode
- Preserves URLs in production
- Platform-aware (only web development needs proxy)

**Implementation:**

.. code:: typescript

   import { wrapWithImageProxy, wrapWithImageProxyIfNeeded } from '../lib/proxy-utils';

   // Always wrap if proxy is enabled
   const proxiedUrl = wrapWithImageProxy('https://zm.example.com/image.jpg');
   // → 'http://localhost:3001/image-proxy?url=https%3A%2F%2Fzm.example.com%2Fimage.jpg'

   // Conditionally wrap (checks if URL is external)
   const url = wrapWithImageProxyIfNeeded('https://zm.example.com/image.jpg');

**Used By:** API functions (monitors, events), download utilities, HTTP
client

--------------

Server Resolver (``lib/server-resolver.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Maps ZoneMinder ServerId values to per-server URLs for multi-server
routing. In single-server setups the map is empty and all lookups return
profile defaults.

**Key functions:**

.. code:: typescript

   import {
     buildServerMap,
     resolveMonitorUrls,
     getPortalUrlForMonitor,
     getPortalUrlForEvent,
     setServerMap,
   } from '../lib/server-resolver';

   // Build the map from /servers.json response
   const serverMap = buildServerMap(servers);
   // Each entry contains: recordingUrl, portalPath, apiBaseUrl

   // Store in module-level cache (called during bootstrap)
   setServerMap(serverMap);

   // Resolve URLs for a monitor by its ServerId
   const urls = resolveMonitorUrls(monitor.ServerId, serverMap, {
     portalUrl: profile.portalUrl,
     apiUrl: profile.apiUrl,
   });

   // Quick lookups for list renderers
   const portalUrl = getPortalUrlForMonitor(monitor.ServerId, profile.portalUrl);
   const eventPortalUrl = getPortalUrlForEvent(monitorId, monitors, profile.portalUrl);

**Caching:** The module maintains a module-level cache updated via
``setServerMap()`` during bootstrap and cleared on profile switch.
React components access the cache reactively via ``useSyncExternalStore``
through the ``useServerUrls`` hook.

**Fallback:** When no servers exist or a ServerId is not found in the
map, all functions return the profile's default URLs.

**Used By:** ``useServerUrls`` hook, ``useMonitorStream``, Server page,
MonitorDetail, EventDetail

--------------

URL Builder (``lib/url-builder.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Centralized URL construction for ZoneMinder endpoints.

**Features:**

- Stream URLs with authentication
- Event image/video URLs
- Control URLs for PTZ
- Consistent parameter handling
- Cache busting support
- Multi-port routing via ``applyMultiPort``

**Multi-port helper:**

.. code:: typescript

   import { applyMultiPort } from '../lib/url-builder';

   // Shared helper for per-monitor port routing
   // Formula: port = minStreamingPort + parseInt(monitorId)
   const url = applyMultiPort('https://zm.example.com/cgi-bin/nph-zms', '4', 7100);
   // → URL with port 7104

All URL builder functions (``getMonitorStreamUrl``, ``getEventImageUrl``,
``getEventVideoUrl``, ``getEventZmsUrl``) accept optional
``minStreamingPort`` and ``monitorId`` parameters. When both are
provided, the output URL's port is rewritten using the multi-port
formula.

**Implementation:**

.. code:: typescript

   import {
     getMonitorStreamUrl,
     getEventImageUrl,
     getEventVideoUrl
   } from '../lib/url-builder';

   // Monitor stream
   const streamUrl = getMonitorStreamUrl(cgiUrl, monitorId, {
     token: accessToken,
     mode: 'jpeg',
     maxfps: 10,
     connkey: 12345,
   });

   // Event thumbnail
   const imageUrl = getEventImageUrl(portalUrl, eventId, frameNumber, {
     token: accessToken,
     width: 320,
     height: 240,
   });

   // Event video download
   const videoUrl = getEventVideoUrl(portalUrl, eventId, {
     token: accessToken,
     format: 'mp4',
   });

   // With multi-port routing
   const streamUrl = getMonitorStreamUrl(cgiUrl, monitorId, {
     token: accessToken,
     mode: 'jpeg',
     connkey: 12345,
     minStreamingPort: 7100,
     monitorId: '4',
   });

**Used By:** API functions (``api/events.ts``, ``api/monitors.ts``),
hooks (``useStreamLifecycle``), and stream/playback components.

--------------

Delayed CMD_QUIT (``lib/zms-quit.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Schedules a fire-and-forget CMD_QUIT for a zms connkey after a grace
delay (``ZM_INTEGRATION.cmdQuitGraceMs``, 150 ms). Pending quits are
tracked per connkey so a remount that reuses the connkey (React
StrictMode's dev double-mount) cancels the quit instead of killing a
stream the surviving mount is still using. A fresh mount generates a
new connkey, so its cancel never matches and the abandoned stream's
quit still fires.

.. code:: typescript

   import { sendDelayedCmdQuit, cancelPendingQuit } from '../lib/zms-quit';

   // On mount: cancel a quit left over from a dev remount
   cancelPendingQuit(connkey);

   // On unmount: schedule the quit; pass a timeout so teardown against
   // an unreachable server cannot hang
   sendDelayedCmdQuit(controlUrl, connkey, {
     timeoutMs: apiTimeoutSeconds > 0 ? apiTimeoutSeconds * 1000 : undefined,
     logContext: { eventId },
   });

**Used By:** ``ZmsEventPlayer``, ``EventThumbnailHoverPreview``.

--------------

Multi-port Resolution (``lib/multiport.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The server's ``ZM_MIN_STREAMING_PORT`` is fetched once during profile
bootstrap and stored on the profile as ``minStreamingPort``. The
per-profile setting ``forceDisableMultiPort`` lets a user opt out for
servers whose per-monitor ports are not reachable. These helpers are the
only sanctioned way to read the effective base port; when the override is
on they return ``undefined``, so ``applyMultiPort`` becomes a no-op and
URLs use the portal's default port.

.. code:: typescript

   import {
     resolveMinStreamingPort,
     getEffectiveMinStreamingPort,
   } from '../lib/multiport';

   // In React components (settings already in scope via useCurrentProfile)
   const port = resolveMinStreamingPort(
     currentProfile?.minStreamingPort,
     settings.forceDisableMultiPort,
   );

   // In services / non-React code (reads both stores by profile id)
   const port = getEffectiveMinStreamingPort(currentProfileId);

Pass the result as ``minStreamingPort`` to the URL builders. Never read
``currentProfile.minStreamingPort`` directly at a call site, or the
toggle is bypassed.

--------------

Event Icons (``lib/event-icons.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Maps event causes from ZoneMinder to Lucide icons for visual display.

**Features:**

- Exact match for known causes (Motion, Alarm, Signal, Linked, etc.)
- Prefix matching for cause variants (e.g., “Motion:All”,
  “Motion:Person” → Motion icon)
- Fallback to Circle icon for unknown causes

**Implementation:**

.. code:: typescript

   import { getEventCauseIcon, hasSpecificCauseIcon } from '../lib/event-icons';

   // Get icon component for a cause
   const Icon = getEventCauseIcon('Motion');  // Returns Move icon
   const Icon2 = getEventCauseIcon('Motion:Person');  // Also returns Move icon (prefix match)
   const Icon3 = getEventCauseIcon('Unknown');  // Returns Circle icon (fallback)

   // Check if cause has a specific (non-fallback) icon
   const hasIcon = hasSpecificCauseIcon('Motion');  // true
   const hasIcon2 = hasSpecificCauseIcon('Custom');  // false

**Mapped Causes:**

- ``Motion`` → Move icon
- ``Alarm`` → Bell icon
- ``Signal`` → Wifi icon
- ``Linked`` → Link icon
- ``Forced Web`` → Hand icon
- ``Continuous`` → Video icon

**Used By:** EventCard, event list components

--------------

Relative Time Labels (``lib/relative-time.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Localized "how long ago" labels for event times. Wraps date-fns
``formatDistanceStrict`` (single unit, e.g. "40 minutes ago") and maps
the app language code to a date-fns locale so the suffix is translated
for all five supported languages.

Two constants from ``lib/zmninja-ng-constants.ts`` control the behavior:

- ``RELATIVE_TIME_LIST_WINDOW_DAYS = 7``: only events within the last 7
  days receive a relative label in the list view
- ``RELATIVE_TIME_JUST_NOW_MS = 60000``: events under 60 s old show
  ``t('events.just_now')`` instead of a numeric distance

**Exports:**

.. code:: typescript

   import {
     dateFnsLocaleFor,
     isWithinDays,
     formatEventRelative,
   } from '../lib/relative-time';

   // Map an i18n language code to a date-fns locale.
   // Supported codes: en (enUS), de, es, fr, zh (zhCN).
   // Unrecognized codes and undefined fall back to enUS.
   // Strips the region suffix ("en-US" becomes "en").
   const locale = dateFnsLocaleFor(i18n.language);

   // True if date is between now and `days` days before now (inclusive).
   if (isWithinDays(event.startTime, RELATIVE_TIME_LIST_WINDOW_DAYS)) {
     // show relative chip
   }

   // Returns t('events.just_now') when diffMs < RELATIVE_TIME_JUST_NOW_MS;
   // otherwise a single-unit "N units ago" string via formatDistanceStrict.
   const label = formatEventRelative(date, i18n.language, t);

**Consumer behavior:**

``EventCard`` renders an ``Hourglass`` chip (``data-testid="event-relative-time"``)
only when ``isWithinDays(startTime, RELATIVE_TIME_LIST_WINDOW_DAYS)`` is true.
Events older than 7 days show no chip.

``EventDetail`` always shows a muted relative line under the Time value
(``data-testid="event-detail-relative-time"``), regardless of age.

**Used By:** EventCard, EventDetail

--------------

Time Utilities (``lib/time.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Date/time formatting and timezone conversion for ZoneMinder API.

**Features:**

- Server-compatible ISO format
- Local datetime formatting for inputs
- Timezone conversion
- Duration formatting

**Implementation:**

.. code:: typescript

   import { formatForServer, formatLocalDateTime } from '../lib/time';

   // For API requests (server timezone)
   const serverTime = formatForServer(new Date());
   // → '2024-01-10 15:30:45'

   // For datetime-local inputs
   const localTime = formatLocalDateTime(new Date());
   // → '2024-01-10T15:30:45'

For user-facing date/time display, use ``useDateTimeFormat()`` (React) or
``formatAppDate``/``formatAppTime``/``formatAppDateTime`` from
``lib/format-date-time.ts`` outside React. These honor the per-profile
``dateFormat`` / ``timeFormat`` settings. For a short weekday label use
``fmtWeekday`` (hook) or ``formatAppWeekday`` (standalone); weekday has no
user preset, so it routes through the same layer for consistency. Never call
``date-fns`` ``format()`` with hard-coded patterns for user-visible output.

**Used By:** API functions, Events page, filters, dashboard widgets

--------------

Crypto Utilities (``lib/crypto.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Encryption/decryption for secure password storage (web platform).

**Features:**

- AES-256-GCM encryption
- Secure key derivation
- Browser SubtleCrypto API
- Base64 encoding for storage

**Implementation:**

.. code:: typescript

   import { encrypt, decrypt } from '../lib/crypto';

   // Encrypt, key is internal (derived once per app install and cached)
   const encrypted = await encrypt('my-password');
   // → Base64 string (IV + ciphertext)

   // Decrypt
   const password = await decrypt(encrypted);
   // → 'my-password'

The encryption key is generated and persisted internally (no key parameter is
required at the call site). A ``decryptLegacy()`` helper exists for migrating
data encrypted with an older key derivation; new code should use ``decrypt()``.

**Used By:** ProfileService, secure storage (web fallback)

--------------

Secure Storage (``lib/secureStorage.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Platform-specific secure storage abstraction.

**Features:**

- **Mobile**: Native keychain/keystore via
  ``@aparajita/capacitor-secure-storage``
- **Web**: Encrypted localStorage via crypto utilities
- Consistent API across platforms

**Implementation:**

.. code:: typescript

   import { saveSecure, getSecure, removeSecure } from '../lib/secureStorage';

   // Save password
   await saveSecure('password_profile_123', 'my-secure-password');

   // Retrieve password
   const password = await getSecure('password_profile_123');

   // Delete password
   await removeSecure('password_profile_123');

**Used By:** ProfileService (password management)

--------------

Platform Detection (``lib/platform.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Platform detection utilities.

**Features:**

- Detects Electron (desktop), Capacitor (mobile), or Web
- Proxy mode detection (development)
- Consistent platform checks

**Implementation:**

.. code:: typescript

   import { Platform } from '../lib/platform';

   if (Platform.isElectron) {
     // Desktop-specific code
   }

   if (Platform.isNative) {
     // Mobile-specific code
   }

   if (Platform.shouldUseProxy) {
     // Wrap URLs with proxy
   }

**Used By:** HTTP client, download utilities, proxy utilities,
platform-specific features

--------------

App Version (``lib/version.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Exposes the app's marketing version and build number.

The marketing version comes from ``package.json`` and is bumped only on a
prod release. The build number is the git commit count
(``git rev-list --count HEAD``), injected at build time as the
``__BUILD_NUMBER__`` compile-time constant by ``vite.config.ts``. It
increases on every commit, so two builds that share a marketing version
are still distinguishable. Outside a git checkout the build number is
``dev``. ``vitest.config.ts`` defines ``__BUILD_NUMBER__`` as ``test``.

**Public API:**

.. code:: typescript

   import { getAppVersion, getBuildNumber, getFullVersion } from '../lib/version';

   getAppVersion();   // "1.1.14"
   getBuildNumber();  // "1509"
   getFullVersion();  // "1.1.14 (1509)"

**Used By:** ``SidebarContent`` renders ``getFullVersion()`` (expanded) or
``getAppVersion()`` (collapsed) in the sidebar footer.

--------------

Safe-Area Bootstrap (``lib/safe-area-bootstrap.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Mirrors iOS ``UIView.safeAreaInsets`` into ``--sai-top``/``--sai-right``/
``--sai-bottom``/``--sai-left`` CSS custom properties on
``document.documentElement``. Works around a bug in iOS WKWebView
(Capacitor 8, ``contentInset='never'``, ``viewport-fit=cover``) where
``env(safe-area-inset-*)`` reports stale values after rotation. On
Dynamic Island devices ``env(top)`` stays ``0`` in portrait, and
``env(left)``/``env(right)`` keep landscape-derived values regardless of
orientation. The native ``SafeArea`` Capacitor plugin reads UIKit's
source of truth and emits ``safeAreaInsetsChanged`` events that this
module applies to the CSS variables.

**Public API:**

.. code:: typescript

   export async function installSafeAreaBootstrap(): Promise<void>

**Wiring:** Called once at app startup, before React mounts:

.. code:: typescript

   // app/src/main.tsx
   import { installSafeAreaBootstrap } from './lib/safe-area-bootstrap'

   void installSafeAreaBootstrap();

   createRoot(document.getElementById('root')!).render(
     <StrictMode><App /></StrictMode>,
   )

**Platform behavior:**

- **iOS (Capacitor)**: Imports ``plugins/safe-area``, calls
  ``SafeArea.getInsets()`` once at startup (initial paint), then
  subscribes to ``safeAreaInsetsChanged`` to update the four
  ``--sai-*`` variables on every UIKit-reported change.
- **Android (Capacitor)**: Early-returns. The Android WebView's
  ``env(safe-area-inset-*)`` resolves correctly, so the CSS fallback
  is used.
- **Web and Electron**: Early-returns. Same reasoning.

**CSS usage:** Reference the variables with the native ``env()`` as the
fallback so non-iOS platforms get the browser value:

.. code:: css

   padding-top: var(--sai-top, env(safe-area-inset-top));

**Plugin shape:** The Capacitor plugin is defined in
``plugins/safe-area/`` with ``getInsets()`` and the
``safeAreaInsetsChanged`` event. Its TypeScript surface is in
``plugins/safe-area/definitions.ts`` (the ``SafeAreaInsets`` and
``SafeAreaPlugin`` types). The web stub never invokes the listener.

**Used By:** ``main.tsx`` (single callsite), CSS rules in ``index.css``
and component styles that consume ``var(--sai-*)``.

--------------

API Validator (``lib/api-validator.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Zod-based runtime validation for API responses.

**Features:**

- Type-safe runtime validation
- Detailed error messages
- Schema coercion (e.g., numbers as strings)

**Implementation:**

.. code:: typescript

   import { validateApiResponse } from '../lib/api-validator';
   import { MonitorsResponseSchema } from '../api/types';

   const response = await fetch('/api/monitors.json');
   const data = await response.json();

   // Validate and coerce types
   const validated = validateApiResponse(MonitorsResponseSchema, data, {
     endpoint: '/api/monitors.json',
     method: 'GET',
   });

**Used By:** All API functions in ``api/`` directory

--------------

Grid Utils (``lib/grid-utils.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Grid layout calculations for montage views.

**Features:**

- Responsive grid column calculations
- Aspect ratio handling
- Breakpoint support

**Implementation:**

.. code:: typescript

   import { calculateGridCols, calculateItemHeight } from '../lib/grid-utils';

   const cols = calculateGridCols(viewportWidth, minCardWidth);
   const height = calculateItemHeight(cardWidth, aspectRatio);

**Used By:** Montage page, EventMontage page, dashboard grid

--------------

Bandwidth Settings (``lib/zmninja-ng-constants.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Configurable polling and refresh intervals that adapt to the user's
bandwidth mode (normal vs. low). Defined in the ``BandwidthSettings``
interface and the ``BANDWIDTH_SETTINGS`` constant map.

**Usage:**

.. code:: typescript

   import { useBandwidthSettings } from '../hooks/useBandwidthSettings';

   const bandwidth = useBandwidthSettings();

   // Use in React Query
   const { data } = useQuery({
     queryKey: ['monitors'],
     queryFn: getMonitors,
     refetchInterval: bandwidth.monitorStatusInterval,
   });

**Available Properties:**

- ``monitorStatusInterval``: Monitor status updates
- ``alarmStatusInterval``: Alarm state checking
- ``consoleEventsInterval``: Event count refreshing
- ``eventsWidgetInterval``: Dashboard events widget
- ``timelineHeatmapInterval``: Timeline/heatmap data
- ``daemonCheckInterval``: Server daemon health
- ``snapshotRefreshInterval``: Snapshot image refresh
- ``zmsStatusInterval``: ZMS playback status polling interval
  (normal: 3000 ms, low: 5000 ms). Used by ``ZmsEventPlayer`` to poll
  the ZMS stream status (``ZM_CMD.QUERY``) for tracking playback
  position.
- ``imageScale``: Image scaling percentage
- ``imageQuality``: Image quality percentage
- ``streamMaxFps``: Maximum stream FPS

**Adding a new property:** Add the field to ``BandwidthSettings`` in
``lib/zmninja-ng-constants.ts`` with values for both ``normal`` and
``low`` modes, then consume it via ``useBandwidthSettings()``.

**Used By:** Dashboard widgets, monitor views, event player, montage,
any component that polls or auto-refreshes

--------------

Monitor Rotation (``lib/monitor-rotation.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Utilities for handling monitor orientation and aspect ratio calculations.

**Key Functions:**

- ``parseMonitorRotation(orientation)``: Parses monitor orientation string to degrees
- ``getMonitorAspectRatio(width, height, orientation)``: Returns aspect ratio string accounting for rotation
- ``getOrientedResolution(width, height, orientation)``: Returns oriented ``WxH`` string (swaps dimensions for 90°/270° rotation)

**Used By:** ``MonitorDetail.tsx``, ``EventDetail.tsx``, ``useMontageGrid.ts``

--------------

Event Utilities (``lib/event-utils.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Shared helpers for event and monitor grid calculations.

**Key Functions:**

- ``getMaxColsForWidth(width, minWidth, margin)``: Calculate maximum grid columns for a given container width
- ``getMonitorDimensions(monitor, fallbackWidth, fallbackHeight)``: Extract monitor dimensions with fallbacks

**Used By:** ``EventListView.tsx``, ``EventMontageView.tsx``, ``useEventMontageGrid.ts``

--------------

Monitor Filters (``lib/filters.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Pure functions that filter monitor lists. They take and return plain
arrays, so they are easy to unit test.

**Key Functions:**

- ``filterEnabledMonitors(monitors)``: Drop deleted monitors
- ``filterExcludedMonitors(monitors, excludedIds)``: Drop monitors whose
  ``Id`` is in ``excludedIds``. Returns the input unchanged when the list is
  empty.
- ``filterMonitorsByGroup(monitors, groupMonitorIds)``: Keep only monitors
  in the given group

**Usage:**

.. code:: typescript

   import { filterExcludedMonitors } from '../lib/filters';

   const visible = filterExcludedMonitors(monitors, ['3', '7']);

**Used By:** ``getMonitors`` in ``api/monitors.ts`` (per-profile monitor
exclusion).

--------------

Profile Settings Accessor (``lib/profile-settings.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Non-React accessors for the current profile's settings. API modules and
other services run outside React and cannot use hooks, so these read the
profile-scoped settings through the Zustand ``getState()`` pattern.

**Key Functions:**

- ``getExcludedMonitorIds()``: Returns the ``excludedMonitorIds`` array for
  the current profile, or an empty array when there is no current profile or
  the stores are not yet initialized.

**Usage:**

.. code:: typescript

   import { getExcludedMonitorIds } from '../lib/profile-settings';

   const excluded = getExcludedMonitorIds();

The ``excludedMonitorIds`` setting itself is defined on ``ProfileSettings``
in ``stores/settings.ts`` and written via ``updateProfileSettings``. It
defaults to an empty array.

**Used By:** ``api/monitors.ts`` and ``api/events.ts`` to apply the
per-profile exclusion at the API boundary.

--------------

Group-Keyed Montage Settings (``stores/settings.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Montage layout state is scoped per monitor group inside a profile. A
profile can show all monitors or one selected group, and each group keeps
its own grid columns, hidden monitors, and saved layouts. Two
``ProfileSettings`` fields hold this state:

.. code:: typescript

   montageByGroup: Record<string, MontageGroupLayout>;
   eventMontageByGroup: Record<string, EventMontageGroupLayout>;

The map key is the group ID, or the ``ALL_GROUPS_KEY`` sentinel when no
group is selected:

.. code:: typescript

   export const ALL_GROUPS_KEY = '__all__';

The active key is ``selectedGroupId ?? ALL_GROUPS_KEY``, where
``selectedGroupId`` is the profile's current group filter (``null`` for
all monitors).

The bucket shapes are:

.. code:: typescript

   interface MontageGroupLayout {
     workingLayout: Layout[];
     savedLayouts: MontageSavedLayout[];
     activeLayoutName: string | null;
     gridCols: number;
     hiddenMonitorIds: string[];
   }

   // Event montage is a uniform grid, so only the column count is scoped.
   interface EventMontageGroupLayout {
     gridCols: number;
   }

``DEFAULT_MONTAGE_GROUP_LAYOUT`` and ``DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT``
supply the values used when a group has no stored bucket. Both default
``gridCols`` to ``2``; the montage default also has an empty
``workingLayout``, empty ``savedLayouts``, ``activeLayoutName: null``, and
empty ``hiddenMonitorIds``. ``DEFAULT_SETTINGS`` starts both maps empty
(``{}``), so a group's bucket is created lazily on first write.

**Reading and writing.** Live montage components use the
``useMontageGroupState()`` hook rather than touching ``montageByGroup``
directly:

.. code:: typescript

   import { useMontageGroupState } from '../hooks/useMontageGroupState';

   const { groupKey, bucket, update } = useMontageGroupState();

   // bucket is the active group's MontageGroupLayout (defaults when absent)
   update({ gridCols: 3, hiddenMonitorIds: ['12'] });

The hook resolves ``groupKey`` from ``useGroupFilter``, reads the matching
bucket (falling back to ``DEFAULT_MONTAGE_GROUP_LAYOUT``), and exposes
``update`` as a partial patch. Internally it calls the store action
``updateMontageGroupLayout(profileId, groupKey, patch)``, which merges the
patch into that group's bucket.

Event montage columns are written through the matching store action:

.. code:: typescript

   const updateEventMontageGroupLayout = useSettingsStore(
     (state) => state.updateEventMontageGroupLayout
   );
   updateEventMontageGroupLayout(profileId, groupKey, { gridCols: 4 });

**Persist migration.** The store is at ``version: 1`` and registers
``migrateSettings`` as its ``migrate`` callback. Persisted state from v0
held flat montage fields (``montageLayouts``, ``montageSavedLayouts``,
``montageActiveLayoutName``, ``montageGridCols``, ``montageGridRows``,
``montageHiddenMonitorIds``, ``eventMontageGridCols``,
``eventMontageLayouts``). The migration removes those fields from each
profile and seeds the ``ALL_GROUPS_KEY`` bucket from them. The old
``montageLayouts.lg`` array becomes the new ``workingLayout``; absent
values fall back to the defaults above. Profiles created after v1 skip
the migration and start with empty maps.

**Dangling group filter self-heal.** A persisted ``selectedGroupId`` can
point at a group that no longer exists on the server. ``useGroupFilter``
resets ``selectedGroupId`` to ``null`` after a successful groups load when
the stored ID is not in the returned list. The reset is gated on the groups
query ``isSuccess`` flag, not ``isLoading``. The groups query is disabled
until the profile is loaded and authenticated, and React Query v5 reports
``isLoading: false`` for a disabled query. Gating on ``isLoading`` let the
empty disabled-state list wipe a valid selection during cold start, which
dropped the montage back to the All-monitors bucket and streamed every
monitor. ``isSuccess`` is false while the query is disabled, loading, or
errored, so the reset only fires once a real fetch has returned.

**Render gate (``isFilterReady``).** Monitor data and group data load from
two separate queries. The monitors query usually returns first, so a page
that renders as soon as monitors arrive would mount tiles before the group
membership is known. Mounting a tile starts its stream, so that one frame
opens streams for every monitor before the group narrows the list.
``useGroupFilter`` exposes ``isFilterReady``: true when no filter is active,
or when a filter is active and the groups query has settled (``isSuccess``
or ``error``). The Montage and Monitors pages hold their loading skeleton
until ``isLoading`` is false and ``isFilterReady`` is true, so tiles first
mount against the final filtered set. The pages also render an empty list
(not all monitors) when a filter is active but ``filteredMonitorIds`` is
empty.

**Used By:** ``useMontageGroupState`` (live montage pages and the grid
hook), the Montage and Monitors page render gates, the event montage column
control, and the persist layer of ``useSettingsStore``.

--------------

Stream Lifecycle (``hooks/useStreamLifecycle.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Shared hook for ZMS stream connection key management and cleanup.

**Features:**

- Generates unique connection keys per monitor
- Sends CMD_QUIT before regenerating keys (prevents orphaned server streams)
- Sends CMD_QUIT on component unmount
- Aborts in-flight image loads on unmount
- Accepts a logger function for component-specific logging

Returns ``forceRegenerate({ killPrevious })`` and ``releaseConnection()``.
``forceRegenerate`` mints a new connkey; pass ``killPrevious: true`` to
CMD_QUIT the previous one first (visibility resume, manual retry, and the
error-driven reconnect all do this, because an ``<img>`` error cannot tell a
dead server process from a dropped-but-alive one, and skipping CMD_QUIT would
orphan an nph-zms process). ``releaseConnection`` CMD_QUITs the current connkey
and clears it from the store without minting a new one; ``useMonitorStream``
calls it when its MJPEG reconnect loop gives up so the final connkey is not
left until unmount. Both are no-ops outside streaming mode.

``useMonitorStream`` builds on this: ``reportStreamError`` (wired to
``<img onError>``) schedules an exponential-backoff reconnect (base 1s, max
15s, cap 6 attempts unless insomnia is on), and ``reportStreamLoad`` (wired to
``<img onLoad>``) resets the backoff after a good frame.

Each lifecycle instance also registers a teardown thunk in the module-level
registry ``lib/active-streams.ts`` (``registerActiveStream`` /
``unregisterActiveStream``). ``switchProfile`` (``stores/profile.ts``) awaits
``quitAllActiveStreams()`` as its first step, before logout and the SSL-trust
flip, so each tile's CMD_QUIT (which captures that tile's own per-server URL
and token) is sent while the previous profile's trust and token are still in
effect. Relying on React unmount alone races the switch: the new profile's
SSL-trust setting can flip before the old self-signed server's CMD_QUIT goes
out, orphaning an nph-zms process. A central quit keyed only by monitor id
cannot do this, since it has no record of which server each stream used.

**Implementation:**

.. code:: typescript

   import { useStreamLifecycle } from '../hooks/useStreamLifecycle';

   const { connKey } = useStreamLifecycle({
     monitorId: monitor.Id,
     portalUrl: profile.portalUrl,
     accessToken: auth.accessToken,
     viewMode: 'streaming', // CMD_QUIT only fires in streaming mode
     mediaRef: imgRef,
     logFn: log.montageMonitor,
   });

**Used By:** ``useMonitorStream``, ``MontageMonitor.tsx``, ``MonitorWidget.tsx``

--------------

Reusable UI Components
----------------------

Located in ``src/components/ui/``, these are primitive components used
throughout the app.

Button (``ui/button.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~

Styled button component with variants.

**Variants:** default, destructive, outline, secondary, ghost, link

**Sizes:** default, sm, lg, icon

**Usage:**

.. code:: tsx

   <Button variant="destructive" size="sm" onClick={handleDelete}>
     Delete
   </Button>

**Used By:** All pages and components

--------------

Card (``ui/card.tsx``)
~~~~~~~~~~~~~~~~~~~~~~

Container component for content sections.

**Sub-components:** Card, CardHeader, CardTitle, CardContent, CardFooter

**Usage:**

.. code:: tsx

   <Card>
     <CardHeader>
       <CardTitle>Monitor Name</CardTitle>
     </CardHeader>
     <CardContent>
       <img src={streamUrl} />
     </CardContent>
     <CardFooter>
       <Button>View Details</Button>
     </CardFooter>
   </Card>

**Used By:** MonitorCard, EventCard, Dashboard widgets, Settings pages

--------------

Dialog (``ui/dialog.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~

Modal dialog for confirmations and forms.

**Sub-components:** Dialog, DialogTrigger, DialogContent, DialogHeader,
DialogTitle, DialogDescription, DialogFooter

**Usage:**

.. code:: tsx

   <Dialog open={isOpen} onOpenChange={setIsOpen}>
     <DialogContent>
       <DialogHeader>
         <DialogTitle>Confirm Delete</DialogTitle>
         <DialogDescription>
           Are you sure you want to delete this event?
         </DialogDescription>
       </DialogHeader>
       <DialogFooter>
         <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
         <Button variant="destructive" onClick={handleConfirm}>Delete</Button>
       </DialogFooter>
     </DialogContent>
   </Dialog>

**Used By:** Event deletion, profile deletion, widget editing, PTZ
presets

--------------

Popover (``ui/popover.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Floating content container for filters and actions.

**Sub-components:** Popover, PopoverTrigger, PopoverContent

**Usage:**

.. code:: tsx

   <Popover>
     <PopoverTrigger asChild>
       <Button variant="outline">
         <Filter className="h-4 w-4" />
       </Button>
     </PopoverTrigger>
     <PopoverContent>
       {/* Filter controls */}
     </PopoverContent>
   </Popover>

**Used By:** Filters (Events, Monitors, Timeline), date range selectors

--------------

SecureImage (``ui/secure-image.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Image component that handles authenticated requests.

**Features:**

- Fetches images with credentials
- Converts to blob URL
- Automatic cleanup

**Implementation:**

.. code:: tsx

   <SecureImage
     src="https://zm.example.com/protected-image.jpg"
     alt="Monitor snapshot"
     className="w-full h-auto"
   />

**How it works:** 1. Fetches image with ``credentials: 'include'`` 2.
Converts response to Blob 3. Creates local blob URL 4. Cleans up on
unmount

**Used By:** Components that need authenticated images (rare - most use
stream URLs with tokens)

--------------

EventThumbnail (``events/EventThumbnail.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Event thumbnail with a user-configurable fallback chain. Receives an
ordered list of candidate URLs (``urls``) and a stable ``cacheKey``
(typically the event id). On ``<img>`` ``onError`` it advances to the
next URL. The image is rendered with ``opacity: 0`` until ``onLoad``
fires, so the browser never flashes its broken-image glyph while the
chain is walking. The winning index is kept in a session-scoped
``Map<cacheKey, index>`` so list re-renders don't re-probe the chain.

**Props:**

.. code:: ts

   interface EventThumbnailProps {
     urls: string[];           // candidate URLs in order
     cacheKey: string;         // stable per-event identifier
     alt?: string;
     objectFit?: CSSProperties['objectFit'];
     className?: string;
   }

**Usage:**

.. code:: tsx

   import { buildThumbnailChain } from '../../lib/thumbnail-chain';
   import { useCurrentProfile } from '../../hooks/useCurrentProfile';

   const { settings } = useCurrentProfile();
   const urls = buildThumbnailChain(portalUrl, event.Id, settings.thumbnailFallbackChain, {
     token: accessToken,
     width,
     height,
     minStreamingPort,
     monitorId: event.MonitorId,
   });

   <EventThumbnail urls={urls} cacheKey={event.Id} alt={event.Name} />

The chain itself comes from the per-profile ``thumbnailFallbackChain``
setting (see ``stores/settings.ts``). ``resolveFallbackFids`` and
``buildThumbnailChain`` in ``lib/thumbnail-chain.ts`` translate the
setting into ordered fids and full URLs. Disabled entries and empty
custom rows are skipped.

**Used By:** EventCard (via EventListView and EventMontageView),
TimelineScrubber thumbnails, NotificationHistory. The EventDetail hero
poster and EventPreviewPopover pick the first fid from the resolved
chain instead of hardcoding ``snapshot``/``alarm``.

--------------

VideoPlayer (``ui/video-player.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

HTML5 video wrapper with platform integration.

**Features:**

- Autoplay control
- Fullscreen support
- Error handling
- Play/pause callbacks

**Usage:**

.. code:: tsx

   <VideoPlayer
     src={videoUrl}
     autoplay={true}
     onPlay={() => console.log('Playing')}
     onPause={() => console.log('Paused')}
   />

**Used By:** EventDetail page (MP4 playback), MonitorDetail (live
streams)

--------------

PasswordInput (``ui/password-input.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Password input with show/hide toggle.

**Features:**

- Eye icon toggle
- Keyboard-accessible
- Standard input props

**Usage:**

.. code:: tsx

   <PasswordInput
     value={password}
     onChange={(e) => setPassword(e.target.value)}
     placeholder="Enter password"
   />

**Used By:** ProfileForm, Login components

--------------

EmptyState (``ui/empty-state.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Placeholder component for empty lists/states.

**Features:**

- Icon support
- Title and description
- Optional action button

**Usage:**

.. code:: tsx

   <EmptyState
     icon={<Inbox className="h-12 w-12" />}
     title="No events found"
     description="Try adjusting your filters"
     action={
       <Button onClick={clearFilters}>Clear Filters</Button>
     }
   />

**Used By:** Events page, Monitors page, Dashboard (when no widgets)

--------------

PullToRefresh (``ui/pull-to-refresh-indicator.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Visual indicator for pull-to-refresh gesture.

**Features:**

- Platform-aware (mobile only)
- Animated spinner
- Progress indication

**Usage:**

.. code:: tsx

   import { usePullToRefresh } from '../hooks/usePullToRefresh';

   const { containerRef, bind, isRefreshing, isPulling, pullDistance } =
     usePullToRefresh({ onRefresh: () => refetch() });

   <div ref={containerRef} {...bind()} className="overflow-y-auto h-full">
     <PullToRefreshIndicator
       isPulling={isPulling}
       isRefreshing={isRefreshing}
       pullDistance={pullDistance}
     />
     {/* Content */}
   </div>

The hook takes a destructured options object (``onRefresh``, optional
``threshold``, optional ``enabled``) and gesture detection is wired through
``@use-gesture/react``'s ``useDrag``. Spread the returned ``bind()`` props
onto the scroll container and attach ``containerRef`` so the hook can read
``scrollTop`` to gate activation.

**Used By:** Events page, Monitors page, Montage page

--------------

QuickDateRangeButtons (``ui/quick-date-range-buttons.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Quick date range selector buttons.

**Features:**

- Predefined ranges (24h, 48h, 1wk, 2wk, 1mo)
- Abbreviated labels with tooltips
- Responsive (hides text on mobile)

**Usage:**

.. code:: tsx

   <QuickDateRangeButtons
     onRangeSelect={({ start, end }) => {
       setStartDate(start);
       setEndDate(end);
     }}
   />

**Used By:** Events filter, Timeline filter, Dashboard widgets

--------------

Select (``ui/select.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~

Dropdown select component.

**Sub-components:** Select, SelectTrigger, SelectValue, SelectContent,
SelectItem

**Usage:**

.. code:: tsx

   <Select value={value} onValueChange={setValue}>
     <SelectTrigger>
       <SelectValue placeholder="Select option" />
     </SelectTrigger>
     <SelectContent>
       <SelectItem value="option1">Option 1</SelectItem>
       <SelectItem value="option2">Option 2</SelectItem>
     </SelectContent>
   </Select>

**Used By:** Settings pages, filters, dashboard widget config

--------------

Switch (``ui/switch.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~

Toggle switch component.

**Usage:**

.. code:: tsx

   <Switch
     checked={enabled}
     onCheckedChange={setEnabled}
   />

**Used By:** Settings pages, filters (favorites toggle)

--------------

Badge (``ui/badge.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~

Small status indicator.

**Variants:** default, secondary, destructive, outline

**Usage:**

.. code:: tsx

   <Badge variant="destructive">Offline</Badge>
   <Badge>5 events</Badge>

**Used By:** MonitorCard (status), EventCard (alarm frames), navigation
(counts)

--------------

Progress (``ui/progress.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Progress bar component.

**Usage:**

.. code:: tsx

   <Progress value={percentage} max={100} />

**Used By:** Background task drawer (download progress)

--------------

Shared Hooks (hooks/)
---------------------

useEventFilters (``hooks/useEventFilters.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Manages event filter state with auto-save persistence. Filter
selections are saved to the settings store immediately via wrapped
setters, no "Apply" button needed for persistence.

**Key concepts:**

- Local state (``selectedMonitorIds``, ``selectedTagIds``, etc.)
  drives the UI and the ``filters`` object for API queries
- Wrapped setters (e.g. ``setSelectedTagIds``) update local state
  AND call ``saveFilterField()`` to write to the settings store
- Restore effect reads from settings on mount/profile change using
  raw ``_set*`` functions (bypasses save wrappers to avoid loops)
- ``ALL_TAGS_FILTER_ID`` sentinel (``'__all_tags__'``) means
  "show events with any tag", mutually exclusive with individual
  tag selections
- ``onlyDetectedObjects`` flag adds ``notesRegexp: 'detected:'``
  to the API filter (server-side Notes REGEXP filter)
- The "Filter" button syncs state to URL params for deep linking
- ``clearFilters()`` resets every filter (used by the popover "Clear"
  button). ``clearDateRange()`` resets only the date range and active
  quick range, leaving the monitor/tag/favorite scope intact. The "x"
  beside the quick-range chips uses ``clearDateRange()`` so removing a
  time window does not widen the list back to all monitors.
- ``applyFilters()`` accepts an optional date-range override. Callers
  that set the date state and call ``applyFilters()`` in the same handler
  (the quick-range chips) must pass the new range, because the callback
  still closes over the pre-update state. Without the override it would
  write the previous range to the URL, and the URL-readback effect would
  reflect that stale range back into state.

**Used By:** Events page, EventsFilterPopover

useScrollRestoration (``hooks/useScrollRestoration.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Restores a scroll container's position across unmount/remount cycles. Takes
``key`` (pass ``useLocation().key``) and ``ready`` (true once the scrollable
content has rendered), and returns a callback ref for the container.

Sibling routes such as ``/events`` and ``/events/:id`` unmount each other, so the
list's scroll container is destroyed when opening an event and recreated empty on
the way back. Positions are stored in a module-level map keyed by the history
entry's ``location.key``: browser back reuses the same key and restores the prior
offset, while fresh navigation (a new key) starts at the top. Restore is deferred
until ``ready`` so the container is tall enough to accept the saved offset, and
runs once per entry so a later scroll is not clobbered.

Because restoration is keyed by the history entry, every "back" affordance must
**pop** history rather than push a path. Esc (``KeyboardShortcuts``) and the
Android back button (``useAndroidBackButton``) call ``navigate(-1)``. The event
detail back arrow routes through ``resolveBackNavigation``
(``lib/back-navigation.ts``), which returns ``pop`` whenever a prior entry exists
and only pushes (to the referrer or ``/events``) on a cold deep-link with no
history. A ``navigate(referrer)`` push would mint a new key and lose the position
(refs #197).

**Used By:** Events page

useAndroidBackButton (``hooks/useAndroidBackButton.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Registers one global Android hardware-back handler (native only, disabled while
the kiosk lock is engaged). The pure ``decideBackAction`` picks the response:
close an open dialog/popover, else navigate back on a detail route, else on a
root (menu) route show "press back again to exit" and exit on a second press
within ``ANDROID_BACK.exitConfirmWindowMs`` (2s). ``isRootRoute`` lists the
top-level menu paths. Called once from ``AppRoutes``.

**Used By:** AppRoutes

KeyboardShortcuts (``components/KeyboardShortcuts.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Global keyboard shortcuts, mounted once under the router. Single letters jump to
each menu section (``d`` Dashboard, ``m`` Montage, ``e`` Events, ``v`` Monitors,
``t`` Timeline, ``n`` Notifications, ``l`` Logs, ``g`` Settings, ``p`` Profiles,
``r`` Server). Digits buffer a monitor number shown in an overlay and, on Enter or
after ``KEYBOARD_SHORTCUTS.monitorJumpCommitMs`` (1s), open the monitor whose
ZoneMinder ID matches (``monitorIdFromBuffer``), not its list position (refs
#200). ``Esc`` goes back (closing an open layer first via
``hasOpenOverlay``), ``?`` toggles a help dialog. Inactive while typing
(``isTypingTarget``), when a modifier is held, when the kiosk is locked, or in TV
mode. The shortcut table and pure helpers live in ``lib/keyboard-shortcuts.ts``.

**Used By:** App (mounted in ``HashRouter``)

Command Palette
~~~~~~~~~~~~~~~

``src/components/CommandPalette.tsx`` is a global palette (refs #207) opened by
the ``/`` key (via ``KeyboardShortcuts``), a sidebar button, or the mobile-header
icon, all through ``useCommandPaletteStore``. It lists pages, monitors (by name
and ID), and groups, filtered by the pure ``filterCommandItems`` helper in
``src/lib/command-palette.ts``. Selecting a page navigates to it, a monitor opens
its live view, and a group sets the group filter and opens Montage.

Event Notes Display
~~~~~~~~~~~~~~~~~~~

ZoneMinder stores object detection results in the ``Notes`` field
(e.g. ``detected:car| Motion: All``), not in ``Cause``. The Notes
field is displayed in EventCard, EventMontageView, EventDetail, and
the dashboard EventsWidget. Everything after ``|`` is stripped in
the display (redundant with Cause) but preserved in the ``title``
attribute for hover.

Sidebar Navigation Reorder
~~~~~~~~~~~~~~~~~~~~~~~~~~

Users can reorder sidebar menu items via an edit mode (pencil icon
in the sidebar). Order is saved per profile in
``ProfileSettings.sidebarNavOrder`` (array of route paths). The
``SidebarContent`` component (``components/layout/SidebarContent.tsx``)
sorts ``navItems`` by saved order using a ``useMemo``. Reorder uses
pointer events for drag-and-drop with live swap on midpoint crossing.

``AppLayout.tsx`` is a thin shell: a desktop sidebar and a mobile header
both render ``SidebarContent`` (navigation, reorder, user controls), where
the bulk of sidebar logic lives. The mobile menu button sits on the left so
it matches the side the drawer opens from. ``LanguageSwitcher`` is a
self-contained language dropdown shown in the ``SidebarContent`` footer
next to the theme and lock controls (a set-once control), not in the header.

--------------

Reusable Domain Components
--------------------------

Located in ``src/components/``, organized by domain.

MonitorFilterPopover (``filters/MonitorFilterPopover.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Monitor selection filter with “All Monitors” toggle.

**Features:**

- Select individual monitors
- “All Monitors” checkbox
- Search/filter monitors
- Used in multiple contexts (Events, Timeline, Dashboard)

**Usage:**

.. code:: tsx

   <MonitorFilterPopoverContent
     monitors={monitors}
     selectedMonitorIds={selectedMonitorIds}
     onSelectionChange={setSelectedMonitorIds}
     idPrefix="events" // for unique checkbox IDs
   />

**Used By:** Events page, Timeline page, Dashboard widget config

--------------

EventsFilterPopover (``events/EventsFilterPopover.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Event filtering UI (extracted from Events page).

**Features:**

- Monitor selection via MonitorFilterPopover
- Favorites-only toggle
- Date range inputs
- Quick date range buttons
- Apply/Clear actions

**Usage:**

.. code:: tsx

   <EventsFilterPopover
     monitors={monitors}
     selectedMonitorIds={selectedMonitorIds}
     onMonitorSelectionChange={setSelectedMonitorIds}
     favoritesOnly={favoritesOnly}
     onFavoritesOnlyChange={setFavoritesOnly}
     startDateInput={startDate}
     onStartDateChange={setStartDate}
     endDateInput={endDate}
     onEndDateChange={setEndDate}
     onQuickRangeSelect={({ start, end }) => {
       setStartDate(formatLocalDateTime(start));
       setEndDate(formatLocalDateTime(end));
     }}
     onApplyFilters={applyFilters}
     onClearFilters={clearFilters}
   />

**Used By:** Events page

--------------

BackgroundTaskDrawer (``BackgroundTaskDrawer.tsx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Drawer UI for background tasks (downloads, uploads, syncs).

**Features:**

- Task progress bars
- Cancellation support
- Auto-expand/collapse states
- Completion badge

**States:**

- Hidden: No tasks
- Expanded: Shows progress bars
- Collapsed: Thin bar at bottom
- Badge: Floating count badge

**Usage:**

.. code:: tsx

   // Automatically rendered in App.tsx layout
   // Controlled by background task store

   // Adding a task
   const taskStore = useBackgroundTasks.getState();
   const taskId = taskStore.addTask({
     type: 'download',
     metadata: { title: 'Video.mp4', description: 'Event 123' },
     cancelFn: () => abortController.abort(),
   });

   // Update progress
   taskStore.updateProgress(taskId, percentage, bytesProcessed);

   // Complete
   taskStore.completeTask(taskId);

**Used By:** Download functions, upload functions (future)

--------------

Usage Matrix
------------

This table shows which components/pages use which shared services:

+---------------------------------------------+------------------------+
| Service/Utility                             | Used By                |
+=============================================+========================+
| **logger**                                  | All components,        |
|                                             | stores, API functions  |
+---------------------------------------------+------------------------+
| **http**                                    | All API functions,     |
|                                             | download utilities     |
+---------------------------------------------+------------------------+
| **download**                                | MonitorCard,           |
|                                             | EventDetail,           |
|                                             | EventCard, VideoPlayer |
+---------------------------------------------+------------------------+
| **proxy-utils**                             | API functions          |
|                                             | (monitors, events),    |
|                                             | download, http         |
+---------------------------------------------+------------------------+
| **url-builder**                             | API functions          |
|                                             | (events, monitors),    |
|                                             | useStreamLifecycle     |
+---------------------------------------------+------------------------+
| **time**                                    | API functions, Events  |
|                                             | page, Timeline,        |
|                                             | Dashboard widgets      |
+---------------------------------------------+------------------------+
| **crypto**                                  | ProfileService, secure |
|                                             | storage (web)          |
+---------------------------------------------+------------------------+
| **secureStorage**                           | ProfileService         |
+---------------------------------------------+------------------------+
| **platform**                                | HTTP client, download, |
|                                             | proxy utilities        |
+---------------------------------------------+------------------------+
| **api-validator**                           | All API functions      |
+---------------------------------------------+------------------------+
| **grid-utils**                              | Montage, EventMontage, |
|                                             | Dashboard              |
+---------------------------------------------+------------------------+

--------------

+-----------------------------------------+----------------------------+
| UI Component                            | Used By                    |
+=========================================+============================+
| **Button**                              | All pages and components   |
+-----------------------------------------+----------------------------+
| **Card**                                | MonitorCard, EventCard,    |
|                                         | Dashboard widgets,         |
|                                         | Settings                   |
+-----------------------------------------+----------------------------+
| **Dialog**                              | Event deletion, Profile    |
|                                         | deletion, Widget editing,  |
|                                         | PTZ presets                |
+-----------------------------------------+----------------------------+
| **Popover**                             | Filters (Events, Monitors, |
|                                         | Timeline), date selectors  |
+-----------------------------------------+----------------------------+
| **SecureImage**                         | (Rare - authenticated      |
|                                         | images)                    |
+-----------------------------------------+----------------------------+
| **VideoPlayer**                         | EventDetail, MonitorDetail |
+-----------------------------------------+----------------------------+
| **PasswordInput**                       | ProfileForm                |
+-----------------------------------------+----------------------------+
| **EmptyState**                          | Events, Monitors,          |
|                                         | Dashboard                  |
+-----------------------------------------+----------------------------+
| **PullToRefresh**                       | Events, Monitors, Montage  |
+-----------------------------------------+----------------------------+
| **QuickDateRangeButtons**               | Events filter, Timeline,   |
|                                         | Dashboard widgets          |
+-----------------------------------------+----------------------------+
| **Select**                              | Settings pages, filters,   |
|                                         | widget config              |
+-----------------------------------------+----------------------------+
| **Switch**                              | Settings pages, favorites  |
|                                         | toggle                     |
+-----------------------------------------+----------------------------+
| **Badge**                               | MonitorCard, EventCard,    |
|                                         | navigation                 |
+-----------------------------------------+----------------------------+
| **Progress**                            | BackgroundTaskDrawer       |
+-----------------------------------------+----------------------------+

--------------

+----------------------------------------------+-----------------------+
| Domain Component                             | Used By               |
+==============================================+=======================+
| **MonitorFilterPopover**                     | Events page, Timeline |
|                                              | page, Dashboard       |
|                                              | widget config         |
+----------------------------------------------+-----------------------+
| **EventsFilterPopover**                      | Events page           |
+----------------------------------------------+-----------------------+
| **BackgroundTaskDrawer**                     | App layout            |
|                                              | (auto-rendered)       |
+----------------------------------------------+-----------------------+

--------------

Adding New Shared Services
--------------------------

When creating a new shared utility, follow these guidelines:

1. Choose the Right Location
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

- ``lib/`` - Pure utilities (no React, no stores)
- ``hooks/`` - React-specific logic
- ``services/`` - Platform-specific bridges (Capacitor plugins)
- ``components/ui/`` - Primitive UI components
- ``components/domain/`` - Domain-specific reusable components

2. Document Usage
~~~~~~~~~~~~~~~~~

Update this file with:

- Description of the utility
- Code examples
- Platform considerations
- List of consumers

3. Follow Patterns
~~~~~~~~~~~~~~~~~~

Look at existing utilities for patterns:

- Consistent error handling
- Logging via component-specific loggers
- Platform detection where needed
- TypeScript types exported

4. Test
~~~~~~~

All shared utilities should have unit tests in ``__tests__/``
subdirectory.

--------------

Navigation Service (``lib/navigation.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Bridges non-React code (services, push notification handlers) with React
Router. Services cannot call ``useNavigate()`` directly, so they emit
navigation events through this singleton and ``NotificationHandler``
listens and forwards them to the router.

**API:**

.. code:: typescript

   import { navigationService } from '../lib/navigation';

   // Navigate to an event (e.g., from push notification tap)
   navigationService.navigateToEvent(eventId, {
     from: '/monitors',        // back-button destination
     fromNotification: true,   // skip lastRoute persistence
   });

   // Generic navigation
   navigationService.navigate('/monitors/5');

   // Listen in a React component
   useEffect(() => {
     const unsubscribe = navigationService.addListener((event) => {
       navigate(event.path, { replace: event.replace, state: event.state });
     });
     return unsubscribe;
   }, [navigate]);

**NavigationState properties:**

- ``from``: explicit back-button destination (read by EventDetail/MonitorDetail
  via ``location.state?.from``)
- ``fromNotification``: when ``true``, AppLayout skips saving the route as
  ``lastRoute`` so the app does not reopen to a transient event playback screen

**Used By:** pushNotifications.ts, NotificationHandler.tsx

--------------

Notification Services (services/)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The notification system spans three services that handle different delivery
mechanisms:

``services/notifications.ts``: WebSocket connection to ZoneMinder Event
Server (ES mode). Handles real-time alarm events via ``zmeventnotification.pl``.

- Singleton via ``getNotificationService()``
- Exponential backoff reconnection with jitter (2s base, 2min cap)
- ``intentionalDisconnect`` flag prevents reconnect after user-initiated
  disconnect; network failures always retry
- ``checkAlive(timeoutMs)`` liveness probe used on app resume and tab
  visibility change
- ``reconnectNow()`` for immediate reconnect on network restore
- Keepalive ping at the profile's bandwidth ``wsKeepaliveInterval``
  (60s normal, 120s low)
- ``reconnectAttempts`` resets only after successful authentication
- No store imports: ``stores/notifications.ts`` injects store-derived values
  (fresh access token, event image URL builder via ``lib/url-builder``,
  keepalive interval) as ``ZMNotificationProviders`` at connect time

``services/pushNotifications.ts``: FCM push notification handling for
iOS and Android.

- Singleton via ``getPushService()``
- Requests permission, obtains FCM token, registers with ZM server
- In ES mode: registers token via WebSocket; in Direct mode: via REST API
- Foreground notifications are processed and added to the notification store
  (but ignored if WebSocket is already connected, to avoid duplicates)
- Handles notification tap to navigate to event detail

``services/eventPoller.ts``: Polls ZM events API for new events in
Direct notification mode on desktop/web.

- Singleton via ``getEventPoller()``
- Started through ``startEventPoller(profileId)`` in ``stores/notifications.ts``
  when ``notificationMode === 'direct'`` and ``Platform.isDesktopOrWeb``
  (not used on mobile, FCM handles delivery). The wiring function injects
  ``EventPollerDeps`` (event sink, token provider, poll interval, portal URL,
  multi-port lookup); the poller has no store imports
- Uses recursive ``setTimeout`` so interval changes take effect on next tick
- Poll interval comes from the profile's bandwidth ``eventPollerInterval``
  (30s normal, 60s low)
- Optional ``Notes REGEXP:detected:`` filter for object-detection-only events
- Maintains a seen-event set (capped at 500) to avoid duplicate notifications

``components/NotificationHandler.tsx``: Headless component that
orchestrates the notification lifecycle:

- Auto-connects WebSocket (ES mode) or starts poller (Direct mode on desktop)
- Listens for ``window.online`` and ``@capacitor/network`` to trigger
  reconnect on network restore
- Desktop: ``visibilitychange`` listener checks WebSocket liveness on tab
  resume
- Mobile: ``appStateChange`` listener checks WebSocket liveness on app resume
- Displays toast notifications for new events
- Clears native badges on app resume (iOS/Android)
- Listens to ``navigationService`` events and forwards them to React Router
  (with state for back-button and lastRoute control)

--------------

Kiosk PIN Utility (``lib/kioskPin.ts``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Handles hashing, storage, and verification of the kiosk mode PIN.
The PIN is never stored in plain text, it is hashed with SHA-256 and
a random 128-bit salt before being written to secure storage.

**Storage:** Uses ``secureStorage.ts`` (Keychain on iOS, Keystore on
Android, encrypted localStorage on web). Keys: ``kiosk_pin_hash`` and
``kiosk_pin_salt``.

**Functions:**

- ``hashPin(pin, salt): Promise<string>``: returns hex-encoded SHA-256
  of ``salt + pin``. Exported for testing; not normally called directly.
- ``storePin(pin): Promise<void>``: generates a random salt, hashes the
  PIN, and stores both hash and salt in secure storage.
- ``verifyPin(pin): Promise<boolean>``: retrieves the stored hash and
  salt, hashes the candidate PIN, and compares.
- ``hasPinStored(): Promise<boolean>``: returns ``true`` if a PIN hash
  is present in secure storage.
- ``clearPin(): Promise<void>``: removes the hash and salt from secure
  storage (used when the user disables kiosk mode via settings).

**Usage:**

.. code:: typescript

   import { storePin, verifyPin, hasPinStored, clearPin } from '../lib/kioskPin';

   // First-time setup
   if (!(await hasPinStored())) {
     await storePin('1234');
   }

   // Unlock attempt
   const ok = await verifyPin(enteredPin);

   // Remove PIN
   await clearPin();

**Used By:** ``hooks/useKioskLock.ts`` (setup flow),
``components/kiosk/KioskOverlay.tsx`` (unlock verification),
``pages/Settings.tsx`` (PIN set/change/clear in Advanced section)

--------------

log-file (``lib/log-file/``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Mirrors entries from ``useLogStore`` to a persistent file on disk.

**Capabilities and file locations by platform:**

- Capacitor (iOS / Android): NDJSON file at ``Directory.Data/zmninja-ng.log`` (sandboxed app data). Resolved at runtime to a ``file://`` URI on iOS and ``content://`` URI on Android. Share via the system share sheet, recipient receives the file as an attachment.
- Electron (desktop): NDJSON file in the Electron user data directory. Concrete paths:

  - macOS: ``~/Library/Logs/com.zoneminder.zmNinjaNG/zmninja-ng.log``
  - Windows: ``%LOCALAPPDATA%\com.zoneminder.zmNinjaNG\logs\zmninja-ng.log``
  - Linux: ``~/.local/share/com.zoneminder.zmNinjaNG/logs/zmninja-ng.log``

  The "Open" button in the Logs page asks the Electron main process to reveal the file in Finder, Explorer, or the system file manager.

- Web: no-op fallback; Share reverts to today's blob download. ``getDisplayPath`` returns ``null`` and the status line is hidden.

**Format:** NDJSON, one ``LogEntry`` per line. ``Logger.formatMessage`` constructs the entry once and passes it to both ``useLogStore.addLog`` and ``LogFileStore.append``.

**Cap:** 10,000 entries. On overflow, the file is rewritten with the last 5,000 entries.

**Hydration:** On app start, ``hydrateLogStoreFromFile()`` reads the file and replaces ``useLogStore.logs`` so prior-session entries are visible in the Logs page.

**Used by:** ``lib/logger.ts``, ``pages/Logs.tsx``.

--------------

Token freshness gate
--------------------

``useFreshAccessToken`` (``hooks/useFreshAccessToken.ts``) returns ``{ token, isFresh }``
where ``isFresh`` is true only when the access token has more than
``ZM_INTEGRATION.accessTokenLeewayMs`` (30 minutes) of validity remaining. While not
fresh, the hook returns ``token: null`` and asks the auth store to refresh in the
background. Any callsite that builds a token-bearing URL the browser or native
runtime loads directly (ZMS streams, event images and videos, push-notification
image backfills) gates URL construction on ``isFresh``. While not fresh, the
callsite emits an empty URL and the existing ``VideoOff`` placeholder shows
through.

For non-React async paths, call ``useAuthStore.getState().getFreshAccessToken()``
directly. The action dedupes concurrent callers, falls through from refresh to
credentials re-login on failure, and resolves with ``null`` if both fail.

