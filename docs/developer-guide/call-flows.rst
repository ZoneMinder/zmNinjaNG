Call Flows
==========

The other chapters are reference material, organized by topic. This one is a
guided tour: it follows a few real user actions end to end, scene by scene,
through the actual code. If you are returning to the codebase and have lost the
mental model, start here, then dip into the reference chapters for depth.

How to read this
----------------

Each flow is a numbered list of scenes. A scene names the code location it
happens in (``file.ts`` plus the function or symbol, which you can search for
in your editor), says what happens and why it matters, and ends with a ``→``
link into the chapter that explains that layer in full. Line numbers drift, so
scenes cite symbols rather than line numbers.

The layers a request moves through, top to bottom:

::

   pages/        route-level views (what you see)
   components/   reusable UI
   hooks/        component logic (React Query, stream lifecycle, ...)
   stores/       global state (Zustand: profile, auth, settings, notifications)
   services/     startup orchestration + native plugin glue
   api/          thin ZoneMinder request wrappers
   lib/          pure helpers (http, url-builder, crypto, ...)
   <native>      Capacitor plugins (iOS/Android/Electron)

Flow 1: Cold start to an authenticated session
----------------------------------------------

When you launch the app with a profile already saved, a lot happens before the
monitor list appears, but the shape is simple: the app restores your saved
profile, throws away any leftover session from last time, points its HTTP client
at your server, and then does the slow network setup (logging in, fetching
server details) **in the background** so the splash screen never sits there
waiting on the network.

Here is the whole flow at a glance. Read down the page: each arrow is one step,
and the dashed box marks the moment the UI becomes usable.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Shell as App shell
       participant Store as Profile store
       participant Boot as Bootstrap services
       participant Auth as Auth + HTTP client
       participant ZM as ZoneMinder server
       participant UI as Monitors page

       Shell->>Store: import store, persist restores the saved profile
       Store->>Boot: onRehydrateStorage then handleProfileRehydration
       Boot->>Auth: clear stale auth and query cache
       Boot->>Auth: create and install the API client
       Boot->>Store: mark initialized
       Note over Shell,UI: UI unblocks here. Splash hides, routes render.
       Boot->>Boot: run bootstrap tasks in the background
       Boot->>Auth: apply SSL trust, then log in
       Auth->>ZM: POST /host/login.json
       ZM-->>Auth: access and refresh tokens
       Boot->>ZM: servers, timezone, ZMS path, multi-port
       UI->>ZM: GET /monitors.json once authenticated
       ZM-->>UI: monitor list, rendered

Now the same steps in detail.

#. **Before React mounts, the safety nets go up.** ``main.tsx`` is the very
   first code to run. It installs the global error handlers (so an uncaught
   error anywhere ends up in the in-app log instead of vanishing), tags the
   ``<html>`` element as native vs web, and starts the iOS safe-area bootstrap,
   then renders ``<App/>``. The reason this is first: nothing that happens later
   should be invisible. → :doc:`11-application-lifecycle`

#. **The stores wake up and read the disk.** Importing the app pulls in the
   Zustand stores. In particular ``stores/profile.ts`` is wrapped in
   ``persist(...)``, so the moment it loads it reads your saved profiles from
   local storage (``STORAGE_KEYS.profilesStore``). ``App.tsx`` also builds the
   single React Query ``queryClient`` and registers it with ``setQueryClient()``
   so non-React code can reach the same cache later. → :doc:`03-state-management-zustand`

#. **Rehydration decides what kind of start this is.** Once persist finishes
   reading, ``stores/profile.ts`` fires ``onRehydrateStorage``, which calls
   ``handleProfileRehydration`` in ``services/profile-initialization.ts``. If
   there is no saved profile it sends you to the Profiles screen and stops; if
   there is one, it continues. The whole thing is wrapped so that any error
   still flips ``isInitialized: true``, which guarantees the splash can never
   hang forever. → :doc:`11-application-lifecycle`

#. **Throw away last session's leftovers.** ``clearStaleState`` calls
   ``logout()`` on the auth store and ``clearQueryCache()``. This matters because
   a persisted token or cached monitor list from a previous run must not be
   shown before we have re-authenticated this run, especially after switching
   servers. → :doc:`03-state-management-zustand`

#. **Point the HTTP client at this server.** ``initializeApiClient`` calls
   ``setApiClient(createStoreApiClient(profile.apiUrl, reLogin))``. From here on,
   every ``httpGet`` / ``httpPost`` in the app resolves through
   ``getApiClient()``, so this one call decides which server all later requests
   talk to. The ``reLogin`` callback it passes in is what lets the client quietly
   re-authenticate when a token lapses. → :doc:`07-api-and-data-fetching`

#. **Let the user in (the important bit).** ``setInitializationState(true)``
   flips ``isInitialized`` and ``isBootstrapping``. This is the moment the UI
   becomes usable: the splash hides, routing renders, and the slow network setup
   is kicked off **without** being awaited, so it runs in the background. The app
   is interactive even while it is still logging in. → :doc:`11-application-lifecycle`

#. **Background setup, SSL trust first.** ``performBootstrap`` in
   ``services/profile-bootstrap.ts`` runs ``bootstrapSSLTrust`` before any network
   call. For a self-signed server it applies the trust override (and, the first
   time, shows the trust-on-first-use dialog) via ``lib/ssl-trust.ts``
   ``applySSLTrustSetting``, which dispatches to the native ``ssl-trust`` plugin
   or Electron. If trust were applied after the login call, a self-signed server
   would reject it. → :doc:`13-network-endpoints`

#. **Log in.** ``bootstrapAuth`` decrypts the stored password and calls the auth
   store's ``login()``, which is single-flight (concurrent callers share one
   request) and POSTs to ``/host/login.json``. On success it stores the access
   and refresh tokens and sets ``isAuthenticated: true``. A failure here is only
   a warning, not fatal, because some servers do not require auth. This is the
   step that produces the authenticated session. → :doc:`07-api-and-data-fetching`

#. **Fetch the server's shape.** Still in the background, ``performBootstrap``
   runs ``bootstrapServerMap`` (multi-server routing), ``bootstrapTimezone``,
   ``bootstrapZmsPath``, ``bootstrapGo2RTCPath``, and
   ``bootstrapMultiPortStreaming``, each wrapped on its own so one failure does
   not sink the rest, then clears ``isBootstrapping``. These resolve the
   streaming and routing details the monitor and montage views rely on.
   → :doc:`13-network-endpoints`

#. **Hide the splash, land on a page.** An effect in ``App.tsx`` hides the
   native splash once ``isInitialized`` is set, and ``AppRoutes`` navigates to
   your last route (or ``/monitors``) and starts the periodic token refresh
   (``useTokenRefresh``). → :doc:`04-pages-and-views`

#. **First real data.** ``pages/Monitors.tsx`` runs a React Query for the monitor
   list, keyed by profile and **gated on ``isAuthenticated``**, so it only fires
   after step 8 set the token. It polls at the bandwidth-profile interval. The
   rendered monitor list is what you finally see. → :doc:`07-api-and-data-fetching`

Switching profiles at runtime (``stores/profile.ts`` ``switchProfile``) converges
on this same ``performBootstrap``; it just tears down the old profile's streams
and resets the client first. That teardown is the last scene of Flow 2.

Flow 2: Montage opens and a live MJPEG stream runs
--------------------------------------------------

How a tile goes from "page mounted" to a live nph-zms feed, and how the
connection key (connkey) is managed so streams never collide or leak.

#. ``pages/Montage.tsx`` ``Montage()`` runs the profile-scoped, bandwidth-throttled
   ``useQuery(['monitors', ...])`` to fetch the monitor list and status.
   → :doc:`04-pages-and-views`

#. ``pages/Montage.tsx`` holds the render behind ``isLoading || !isFilterReady``.
   Mounting a tile starts its stream, so the page must not flash the full
   monitor set before the group/hidden filter narrows it, which would open
   every stream at once. → :doc:`04-pages-and-views`

#. ``pages/Montage.tsx`` maps each monitor to a grid cell wrapping
   ``MontageTileErrorBoundary`` then ``MontageMonitor``, keyed by ``Monitor.Id``.
   One tile per monitor; the boundary isolates a crashing tile.
   → :doc:`05-component-architecture`

#. ``components/monitors/MontageMonitor.tsx`` (memoized) renders the tile chrome
   and embeds ``LiveMonitorPlayer``. ``memo`` prevents grid re-renders from
   tearing the stream down and back up. → :doc:`05-component-architecture`

#. ``components/monitors/LiveMonitorPlayer.tsx`` computes
   ``effectiveStreamingMethod`` (``webrtc`` vs ``mjpeg``) from the user setting,
   ``monitor.Go2RTCEnabled``, and ``profile.go2rtcUrl``; go2rtc failures fall
   back to MJPEG. → :doc:`go2rtc-integration`

#. ``components/monitors/LiveMonitorPlayer.tsx`` calls ``useMonitorStream({...})``
   with ``enabled`` true for MJPEG (or as the MJPEG-first placeholder while MSE
   connects). This hook owns the MJPEG URL and connkey.
   → :doc:`05-component-architecture`

#. ``hooks/useMonitorStream.ts`` ``useMonitorStream`` resolves the profile, a
   fresh access token (``useFreshAccessToken``), per-server URLs
   (``useServerUrls``), the view mode, and the multi-port base. It assembles
   everything needed for a valid stream URL and matching CMD_QUIT URL.
   → :doc:`07-api-and-data-fetching`

#. ``hooks/useStreamLifecycle.ts`` ``useStreamLifecycle`` mount effect calls
   ``regenerateConnKey(monitorId)`` and sets ``connKey``. Each concurrent stream
   needs a unique key so ZoneMinder's nph-zms processes do not collide.
   → :doc:`12-shared-services-and-components`

#. ``stores/monitors.ts`` ``regenerateConnKey`` / ``generateAndSetConnKey``
   generates a random key and stores it in the persisted ``connKeys[monitorId]``
   map, so teardown can compare-and-clear exactly the key it owns.
   → :doc:`12-shared-services-and-components`

#. ``hooks/useMonitorStream.ts`` builds ``streamUrl`` via ``getStreamUrl``
   (``api/monitors.ts`` then ``lib/url-builder.ts`` ``buildMonitorStreamUrl`` →
   ``/cgi-bin/nph-zms``) only once ``connKey !== 0`` and the token is fresh, then
   mirrors it into ``imageSrc``. The gate prevents minting a zombie stream
   before a key exists. → :doc:`07-api-and-data-fetching`

#. ``components/monitors/LiveMonitorPlayer.tsx`` binds
   ``<img src={imageSrc} onLoad onError>``. The browser opens the multipart MJPEG
   connection directly through the ``<img>``; the connkey lives in the ``src``.
   → :doc:`05-component-architecture`

#. ``hooks/useMonitorStream.ts`` ``reportStreamLoad`` (from ``onLoad``) zeroes the
   reconnect attempt counter and cancels any pending reconnect, so a healthy
   frame resets the backoff. → :doc:`05-component-architecture`

#. ``hooks/useMonitorStream.ts`` ``reportStreamError`` (= ``scheduleReconnect``,
   from ``onError``) schedules an exponential-backoff reconnect, then calls
   ``forceRegenerate({ killPrevious: true })``; at the attempt cap it calls
   ``releaseConnection()`` instead. An ``<img>`` error cannot tell a dead server
   process from a dropped-but-alive one, so it CMD_QUITs the old key before
   minting a new one. → :doc:`12-shared-services-and-components`

#. ``hooks/useStreamLifecycle.ts`` unmount cleanup runs ``quitStreamForParams``
   (CMD_QUIT + compare-and-clear the stored key) and ``removeAttribute('src')`` to
   abort the in-flight nph-zms connection. This prevents zombie streams when a
   tile leaves the grid. → :doc:`11-application-lifecycle`

#. ``hooks/useStreamLifecycle.ts`` registers a teardown thunk in
   ``lib/active-streams.ts``; on a profile switch, ``stores/profile.ts``
   ``switchProfile`` awaits ``quitAllActiveStreams()`` first, while the old
   profile's SSL trust and token are still in effect. Relying on React unmount
   alone races the switch and can orphan an nph-zms process.
   → :doc:`11-application-lifecycle`

Flow 3: A push notification, from registration to tap
-----------------------------------------------------

Native only (iOS/Android). Every ``@capacitor-firebase/messaging`` call sits
behind a ``Platform.isNative`` check and a dynamic ``import()``, so on web the
whole flow short-circuits.

**Registration (on startup)**

#. ``App.tsx`` mounts the headless ``<NotificationHandler/>`` once. It renders no
   UI of its own and exists to wire notification side effects.
   → :doc:`05-component-architecture`

#. ``components/NotificationHandler.tsx`` reads the current profile and settings
   and delegates to three hooks: ``useNotificationAutoConnect``,
   ``useNotificationPushSetup``, ``useNotificationDelivered``.
   → :doc:`05-component-architecture`

#. ``hooks/useNotificationPushSetup.ts`` (effect gated on
   ``Platform.isNative && settings.enabled``) registers the token against the
   active profile and selected backend: it re-registers if the push service is
   ready, else calls ``initialize()`` for the first time.
   → :doc:`11-application-lifecycle`

#. ``services/pushNotifications.ts`` ``getPushService`` is a module-level
   singleton holding ``currentToken`` and init state, so token state survives
   re-renders and profile switches. → :doc:`12-shared-services-and-components`

#. ``services/pushNotifications.ts`` ``initialize`` imports ``FirebaseMessaging``
   and calls ``requestPermissions()``, proceeding only when granted. No token
   without OS push permission. → :doc:`12-shared-services-and-components`

#. ``services/pushNotifications.ts`` ``_createNotificationChannel`` (Android only)
   creates the FCM channel ``id: 'zmninja-ng'``, ``importance: 4`` (HIGH).
   Android needs a high-importance channel for heads-up banners (and the
   manifest's ``default_notification_channel_id`` routes channel-less server
   pushes here). → :doc:`12-shared-services-and-components`

#. ``services/pushNotifications.ts`` ``_setupListeners`` registers
   ``tokenReceived``, ``notificationReceived``, and ``notificationActionPerformed``
   before ``getToken`` so a token refresh is never missed.
   → :doc:`11-application-lifecycle`

#. ``services/pushNotifications.ts`` ``getToken`` fetches the FCM token (retrying
   once after 5s on transient failure) and stores it in ``currentToken``.
   → :doc:`12-shared-services-and-components`

#. ``services/pushNotifications.ts`` ``_registerWithServer`` forks on
   ``settings.notificationMode``: direct mode calls ``api/notifications``
   ``registerToken``; ES mode registers over the websocket
   (``stores/notifications.ts``), deferring until connected.
   → :doc:`07-api-and-data-fetching`

#. ``api/notifications.ts`` ``registerToken`` POSTs a form-encoded
   ``Notification[...]`` body to ``/notifications.json`` via ``client.postForm``.
   ZoneMinder's notifications endpoint expects form fields, not JSON.
   → :doc:`07-api-and-data-fetching`

**A push arrives and the user taps it**

#. ``services/pushNotifications.ts`` ``notificationReceived`` → ``_handleNotification``
   (foreground): ignored if already connected to the event server (the same
   event arrives over the websocket), otherwise it builds a snapshot URL for the
   current profile and adds the event via the notification store.
   → :doc:`03-state-management-zustand`

#. ``services/pushNotifications.ts`` ``notificationActionPerformed`` →
   ``_handleNotificationAction`` (tap) resolves the target profile and stores the
   event under it. → :doc:`12-shared-services-and-components`

#. ``lib/notification-profile.ts`` ``resolveProfileForNotification`` matches the
   payload's profile name to a stored profile. Same profile navigates directly;
   a different profile calls ``requestProfileSwitch`` to ask first.
   → :doc:`12-shared-services-and-components`

#. ``components/NotificationHandler.tsx`` subscribes to switch requests, shows the
   confirm dialog, and on confirm calls ``switchProfile`` then
   ``navigationService.navigateToEvent``. → :doc:`05-component-architecture`

#. ``lib/navigation.ts`` ``navigationService`` is a non-React event bus;
   ``NotificationHandler``'s listener effect catches the navigate event and calls
   React Router's ``navigate``, landing on ``/events/:id``. Services cannot use the
   router hook, so navigation is bridged through this listener.
   → :doc:`12-shared-services-and-components`

#. ``hooks/useNotificationDelivered.ts`` reconciles pushes that arrived while the
   app was killed or backgrounded: on cold start and on ``appStateChange`` it reads
   ``getDeliveredNotifications()``, ingests them into history, clears them, and
   syncs the badge. → :doc:`11-application-lifecycle`

These three flows touch most of the moving parts. When you need to change
something, find the nearest scene, jump to that ``file.ts`` symbol, and follow
the ``→`` link for the full picture.
