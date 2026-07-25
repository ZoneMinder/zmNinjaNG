Application Lifecycle
=====================

How the app runs from launch to shutdown, a runtime map of zmNinjaNg.

1. The Entry Point (``index.html`` → ``main.tsx``)
--------------------------------------------------

Everything starts at ``app/index.html``, the container for the React app.

1. **Load**: The browser, Electron Chromium (desktop), or Capacitor
   WebView (mobile) loads ``index.html``.
2. **Script**: It loads ``src/main.tsx`` (the TypeScript entry point).
3. **Mount**: ``main.tsx`` finds the ``<div id="root">`` element and
   "mounts" the React application into it.

.. code:: tsx

   // src/main.tsx
   createRoot(document.getElementById('root')!).render(
     <StrictMode>
       <App />
     </StrictMode>,
   )

Both names are imported directly: ``createRoot`` from ``react-dom/client`` and
``StrictMode`` from ``react``. ``StrictMode`` deliberately mounts every
component twice in development, running each effect's setup, then its cleanup,
then its setup again. That matters more here than in most apps, because effects
in this codebase open MJPEG streams and WebSocket connections. Anything that
connects on mount has to survive being torn down and reconnected immediately, so
several hooks guard or delay their connect for exactly this reason.
``StrictMode`` has no effect in a production build.

2. Bootstrapping Phase (``App.tsx``)
------------------------------------

When ``<App />`` renders, the app is not yet ready to use. It must
rehydrate its state from storage and bootstrap the active profile.

Rehydrating persisted state
~~~~~~~~~~~~~~~~~~~~~~~~~~~

The ``useProfileStore`` attempts to read saved profiles and the last
active user from browser ``localStorage`` (the default Zustand
``persist`` storage; this is what runs on web, Electron, and the
Capacitor webviews). Sensitive values like the encrypted password go
through ``lib/security/secureStorage.ts``, which delegates to the Capacitor
secure-storage plugin on iOS/Android and to encrypted localStorage on
web/Electron.

- **State**: ``isInitialized`` starts as ``false``.
- **Visual**: User sees ``<RouteLoadingFallback />`` (a spinner).
- **Mechanism**: ``zustand/persist`` triggers ``onRehydrateStorage``.

Profile Bootstrap
~~~~~~~~~~~~~~~~~

Once storage is rehydrated and a profile exists, the app bootstraps the
profile:

1. **State**: ``isBootstrapping`` becomes ``true``.
2. **Visual**: User sees a bootstrap overlay with progress steps and a
   **Cancel** button.
3. **Steps**:

   - Clear stale auth/cache from previous session
   - Initialize API client with profile's ``apiUrl``
   - Authenticate with stored credentials
   - Fetch server timezone
   - Fetch ZMS path from server config
   - Fetch Go2RTC path (if configured)
   - Check multi-port streaming configuration
   - Bootstrap server map (``bootstrapServerMap()``)

Bootstrap Server Map
~~~~~~~~~~~~~~~~~~~~

After authentication, the bootstrap process calls
``bootstrapServerMap()``:

1. Fetches ``/servers.json`` from the ZoneMinder API
2. Builds a ServerId-to-URLs map via ``buildServerMap()`` from
   ``lib/zm/server-resolver.ts``
3. Stores the map in the module-level cache via ``setServerMap()``
4. The cache is cleared on profile switch

For single-server setups the map is empty. All URL lookups in
``resolveMonitorUrls`` and ``getPortalUrlForMonitor`` return the
profile's default URLs when the map is empty or a ServerId is not found.

Bootstrap Cancellation
~~~~~~~~~~~~~~~~~~~~~~

If the server is unreachable or bootstrap takes too long, users can
cancel:

- **Action**: Click "Cancel" button on bootstrap overlay
- **Effect**: Calls ``cancelBootstrap()`` which clears
  ``currentProfileId``
- **Navigation**:

  - If other profiles exist → redirects to ``/profiles`` (profile
    selection)
  - If no profiles exist → redirects to ``/profiles/new`` (add profile)

Initialization Complete
~~~~~~~~~~~~~~~~~~~~~~~

Once bootstrap completes (or is cancelled):

1. ``isInitialized`` becomes ``true``, ``isBootstrapping`` becomes
   ``false``.
2. ``AppRoutes`` decides where to send the user, on the ``/`` route:

  - **Active profile**: Redirects to the last visited route, or ``/monitors``
    if there is none.
  - **Profiles exist, none active**: Redirects to ``/profiles`` to pick one.
  - **No profiles at all**: Redirects to ``/profiles/new``.

3. The Authentication Flow
--------------------------

zmNinjaNg handles authentication differently than a typical SaaS app because
it connects to potentially *any* ZoneMinder server, each with different
auth requirements.

A. Token Exchange
~~~~~~~~~~~~~~~~~

When you log in or the app wakes up:

1. **Credentials**: We retrieve the username/password (decrypted from
   SecureStorage).
2. **Login API**: ``login()`` in ``api/auth.ts`` posts form-encoded credentials
   to ``/host/login.json``. ZoneMinder wants a form body here, not JSON, so the
   call goes through ``client.postForm`` rather than the usual JSON path.
3. **Response**: Server returns ``access_token`` and ``refresh_token``, which
   ``LoginResponseSchema.parse`` validates before anything reads them.
4. **Store**: Tokens are saved to ``useAuthStore`` (in memory mostly,
   refresh token persisted).

``refreshToken()`` in the same file posts to ``/host/login.json`` as well,
sending the refresh token instead of the credentials. There is one login
endpoint, not two.

B. The Refresh Loop
~~~~~~~~~~~~~~~~~~~

Access tokens expire on a schedule the ZoneMinder server chooses. The app has to
replace one before it lapses, without the user noticing.

- **Hook**: ``useTokenRefresh`` runs in ``AppRoutes`` (``App.tsx``).
- **Logic**: It checks immediately, then every
  ``ZM_INTEGRATION.tokenCheckInterval`` (60 seconds), and again whenever the
  document becomes visible. If the access token expires within
  ``ZM_INTEGRATION.accessTokenLeewayMs`` (30 minutes), or has already expired,
  it calls ``getFreshAccessToken()``.
- **Why the visibility check**: on mobile and in throttled browser tabs the
  interval timer stops firing while backgrounded, so a token can lapse with no
  check having run. The token is refreshed on the way back in, not on a timer
  that was asleep.
- **Why one shared call**: the timer, a component's proactive refresh, and a
  401 recovery can all want a new token at once. ``refreshAccessToken`` in
  ``stores/auth.ts`` keeps a single in-flight promise, so concurrent callers
  attach to the same POST instead of racing three of them.
- **On failure**: ``refreshAccessToken`` calls ``get().logout()`` and rethrows.
  The logout happens in the store, so ``useTokenRefresh`` only logs the error;
  it does not handle sign-out itself. Note what ``logout()`` does not do: it
  clears the tokens and sets ``isAuthenticated`` to false, but it does not clear
  the current profile and does not navigate anywhere. There is no redirect to a
  login screen, because there is no login screen. The user stays on the page
  they were on, and the next query needing auth fails with a 401 that
  ``resolveQueryError`` turns into a localized prompt to re-authenticate.

4. The "Main Loop" (Runtime)
----------------------------

Once logged in and on the Dashboard, several background processes keep
the app alive.

Every interval below except the token check comes from
``BANDWIDTH_SETTINGS`` in ``lib/zmninja-ng-constants.ts``, read through
``useBandwidthSettings()``. Each has a ``normal`` and a ``low`` value, and
switching the profile to low-bandwidth mode slows all of them at once. Both
values are given.

1. **Token Refresh**: Background timer checks token expiry every 60
   seconds (``ZM_INTEGRATION.tokenCheckInterval``) and refreshes once within 30
   minutes of expiry (``ZM_INTEGRATION.accessTokenLeewayMs``). This one is not
   bandwidth-scaled: a lapsed token breaks everything, so it is not a knob.
2. **Event Polling**: Dashboard event widgets poll on
   ``eventsWidgetInterval`` (30s / 60s). The monitor-detail recent-events list
   uses ``monitorRecentEventsInterval`` (30s / 60s).
3. **Monitor Status**: The monitor list polls ``monitorStatusInterval``
   (20s / 40s). Alarm state on the Monitor Detail page polls the faster
   ``alarmStatusInterval`` (5s / 10s), because an alarm the user cannot see
   within a few seconds is not worth showing.
4. **Stream Keep-Alive**: Streaming connections (``useMonitorStream``, via
   the ``useStreamLifecycle`` hook it composes) monitor their own health. If a
   stream dies, they reconnect with a fresh connection key (``connkey``),
   releasing the dead one with ``ZMS_COMMANDS.cmdQuit`` first so ZMS does not
   leak the old process.
5. **WebSocket Keepalive & Reconnect**: The notification WebSocket
   (``services/notifications.ts``) sends a version-request ping every
   ``wsKeepaliveInterval`` (60s / 120s) to maintain the connection. On
   disconnection, it reconnects automatically using exponential backoff with
   jitter (2s, 4s, 8s, ... plus or minus 25%). The cap depends on whether the
   app is on screen: ``maxReconnectDelay`` (2 minutes) while the document is
   hidden, ``NOTIFICATIONS_SERVICE.foregroundMaxReconnectDelayMs`` (15 seconds)
   while it is visible, so a user watching a disconnected badge is not left
   waiting on a two-minute timer. An ``intentionalDisconnect`` flag ensures only
   user-initiated disconnects stop reconnection; network drops always
   retry. On mobile, ``@capacitor/network`` triggers immediate reconnect
   when connectivity is restored. On desktop, a ``visibilitychange``
   listener checks liveness when a tab becomes visible.
   ``NotificationHandler`` delegates this work to three focused hooks:
   ``useNotificationAutoConnect`` (connection lifecycle and reconnection),
   ``useNotificationPushSetup`` (FCM token initialization on mobile), and
   ``useNotificationDelivered`` (cold start notification processing and
   resume badge sync)
6. **Daemon Status**: Server page checks ZoneMinder daemon health on
   ``daemonCheckInterval`` (30s / 60s)

For a reference of all timers, polling intervals, and scheduled
actions across the application, see :doc:`07-api-and-data-fetching`.

5. Mobile Lifecycle (Capacitor)
-------------------------------

On iOS and Android, the app has unique lifecycle states handled by the
OS.

Backgrounding
~~~~~~~~~~~~~

When the user swipes the app away (but doesn't close it):

- **State**: App goes to Background, and Capacitor fires ``pause`` and
  ``appStateChange``.
- **Limit**: JS execution pauses (mostly). Intervals stop firing, so anything
  that depends on a timer is stale on return.
- **Streams**: Nothing explicitly pauses the MJPEG streams. The OS suspends the
  webview, the socket goes quiet, and the stream is simply dead when the app
  comes back. Recovery happens on resume, not on the way out.
- **Logs**: ``App.tsx`` flushes the log buffer on ``pause`` so entries are not
  lost if the OS kills the process while it is backgrounded.

Resuming
~~~~~~~~

When the user re-opens the app:

- **State**: App comes to Foreground.
- **Streams**: ``useVisibilityResume`` fires and ``useMonitorStream`` mints a
  fresh ``connkey`` and rebinds. It debounces on ``minHiddenMs`` (1500ms by
  default) so that a quick alt-tab does not trigger a reconnect storm.
- **Token**: ``useTokenRefresh`` re-checks expiry on ``visibilitychange``,
  because its 60-second interval was not running while suspended.
- **WebSocket Liveness**: ``useNotificationAutoConnect`` calls
  ``service.checkAlive(5000)``, which sends a ping and waits for a response. If
  the server does not respond within those 5 seconds, the connection is treated
  as dead and a forced reconnect is triggered: the socket still reads as open,
  so an ordinary ``reconnectNow()`` would decline (refs #274). When the store
  already reads disconnected, resume skips the ping and reconnects immediately
  rather than waiting on a backoff timer that the suspended WebView froze. That
  resume nudge is a single attempt: when it fails, the foreground backoff cap
  above is what retries.
- **Badge Clear**: ``useNotificationDelivered`` listens for ``appStateChange``,
  ingests any notifications delivered while backgrounded into the history
  store, then clears the native badge via
  ``FirebaseMessaging.removeAllDeliveredNotifications()``.

Note two things resume does **not** do. There is no idle timeout: the app does
not track a last-interaction timestamp and does not re-lock after a period
away. And biometric authentication is not a resume gate. Kiosk lock is
user-initiated (``useKioskLock``, from the sidebar or the fullscreen montage
controls), and ``KioskOverlay`` offers biometrics only as a way to dismiss a
lock the user already set. ``useKioskStore`` is ephemeral and resets to
unlocked on app restart.

6. Navigation Lifecycle
-----------------------

We use ``react-router-dom`` for navigation, inside a ``HashRouter``.

- **Routes**: Defined in ``AppRoutes`` (``App.tsx``). Every page is a
  ``lazy()`` import, so its code is fetched the first time the route is
  visited, not at startup.
- **Behavior**: When you navigate from ``/monitors`` to ``/events``:

  1. ``pages/Monitors.tsx`` **unmounts**. React runs the cleanup function
     returned by each of its effects, which is what closes the live streams.
  2. ``pages/Events.tsx`` **mounts**. Its effects run for the first time and
     its queries start fetching.

Unmounting is not a pause. React discards the component instance and every
``useState`` value in it. Anything that must outlive navigation has to be stored
somewhere else: the Events page keeps its result count in ``useState`` and
mirrors it into ``useEventPaginationStore`` (``stores/eventPagination.ts``),
keyed by profile and filters, precisely because opening an event unmounts the
page and a purely component-local count would collapse back to the first page
when the user navigated back.

The one place this bites is scroll position, which is component-local by
default. Persist it to a Zustand store if a screen needs to restore it.

