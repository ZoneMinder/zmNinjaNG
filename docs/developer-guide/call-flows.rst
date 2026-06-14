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

What happens between launching the app and seeing the monitor list, for a user
who already has a saved profile.

#. ``main.tsx`` (module top level) installs global error handlers, tags
   ``<html>`` as native, mirrors iOS safe-area insets into CSS variables, then
   renders ``<App/>``. Logging and error capture are live before any app code
   runs. → :doc:`11-application-lifecycle`

#. ``App.tsx`` builds the single React Query ``queryClient`` and hands it to
   ``setQueryClient()`` so non-React code (cache clearing on switch/rehydrate)
   can reach the same cache. → :doc:`07-api-and-data-fetching`

#. ``stores/profile.ts`` ``create(persist(...))``: importing the profile store
   constructs it and Zustand-persist immediately reads
   ``STORAGE_KEYS.profilesStore`` from local storage. This is the entry point
   for all rehydration. → :doc:`03-state-management-zustand`

#. ``stores/profile.ts`` ``onRehydrateStorage`` fires once storage is read and
   delegates to ``handleProfileRehydration``, inside a try/catch that force-sets
   ``isInitialized: true`` on any error so the splash can never hang.
   → :doc:`03-state-management-zustand`

#. ``services/profile-initialization.ts`` ``handleProfileRehydration`` branches:
   no current profile sends the user to ``/profiles``; a valid profile proceeds
   to clear, init, and bootstrap. This decides whether we authenticate at all.
   → :doc:`11-application-lifecycle`

#. ``services/profile-initialization.ts`` ``clearStaleState`` calls
   ``useAuthStore.getState().logout()`` and ``clearQueryCache()``. Stale data
   from a previous session must not bleed into the new one before re-auth.
   → :doc:`03-state-management-zustand`

#. ``services/profile-initialization.ts`` ``initializeApiClient`` calls
   ``setApiClient(createStoreApiClient(profile.apiUrl, reLogin))``. Every later
   ``httpGet``/``httpPost`` resolves through ``getApiClient()``; the ``reLogin``
   callback lets the client self-heal a lapsed token.
   → :doc:`07-api-and-data-fetching`

#. ``services/profile-initialization.ts`` ``setInitializationState(true)`` sets
   ``isInitialized: true`` and ``isBootstrapping: true``. This unblocks the UI:
   the splash hides and routing renders while network bootstrap runs in the
   background. → :doc:`11-application-lifecycle`

#. ``services/profile-bootstrap.ts`` ``performBootstrap`` runs
   ``bootstrapSSLTrust`` first, before any network call. For a self-signed
   profile it applies the trust override (and, with no stored fingerprint,
   triggers the trust-on-first-use dialog). SSL trust must be in effect before
   the login HTTPS call or self-signed servers fail. → :doc:`13-network-endpoints`

#. ``lib/ssl-trust.ts`` ``applySSLTrustSetting`` is platform-dispatched: native
   uses the ``ssl-trust`` Capacitor plugin, Electron uses
   ``window.electronSsl``, web is a no-op. This is a manual-device-verify path.
   → :doc:`12-shared-services-and-components`

#. ``services/profile-bootstrap.ts`` ``bootstrapAuth`` decrypts the stored
   password and calls ``useAuthStore.getState().login()``, which is single-flight
   and on success sets ``accessToken``, expiries, and ``isAuthenticated: true``.
   Auth failure is a warning, not fatal (the server may not require auth). This
   produces the authenticated session. → :doc:`07-api-and-data-fetching`

#. ``services/profile-bootstrap.ts`` then runs ``bootstrapServerMap``,
   ``bootstrapTimezone``, ``bootstrapZmsPath``, ``bootstrapGo2RTCPath``, and
   ``bootstrapMultiPortStreaming`` (each independently try/caught), then clears
   ``isBootstrapping``. These resolve the stream and routing config the monitor
   views depend on. → :doc:`13-network-endpoints`

#. ``App.tsx`` splash-hide effect dynamically imports ``@capacitor/splash-screen``
   and hides it once ``isInitialized`` flips; ``AppRoutes`` navigates to the last
   route or ``/monitors`` and starts ``useTokenRefresh()``.
   → :doc:`04-pages-and-views`

#. ``pages/Monitors.tsx`` runs ``useQuery(['monitors', currentProfile?.id], ...)``
   gated on ``isAuthenticated`` and polled at ``bandwidth.monitorStatusInterval``.
   This is the first data loaded: the monitor list rendered to the user.
   → :doc:`07-api-and-data-fetching`

The runtime profile switch (``stores/profile.ts`` ``switchProfile``) converges
on the same ``performBootstrap``; it additionally tears down the old profile's
streams and resets the client first (see Flow 2, last scene).

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
