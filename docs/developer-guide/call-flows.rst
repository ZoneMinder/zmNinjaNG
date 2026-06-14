Call Flows
==========

The other chapters are reference material, organized by topic. This one is a
guided tour: it follows a few real user actions end to end, scene by scene,
through the actual code. If you are returning to the codebase and have lost the
mental model, start here, then dip into the reference chapters for depth.

How to read this
----------------

Each flow opens with a sequence diagram (the whole flow at a glance), then walks
the steps in detail. Every step has a bold plain-language lead, says what happens
and why it matters, names the code it lives in (``file.ts`` plus the function or
symbol), and ends with two links: ``source`` opens that exact code on GitHub, and
the ``→`` link goes to the reference chapter that explains that layer in full.

The ``source`` links point at ``main`` and the function may drift by a few lines
over time, so the symbol name in the text is the durable anchor.

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

#. **Before React mounts, the safety nets go up.** ``main.tsx`` is the very
   first code to run. It installs the global error handlers (so an uncaught
   error anywhere ends up in the in-app log instead of vanishing), tags the
   ``<html>`` element as native vs web, and starts the iOS safe-area bootstrap,
   then renders ``<App/>``. The reason this is first: nothing that happens later
   should be invisible.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/main.tsx#L12>`__
   · → :doc:`11-application-lifecycle`

#. **The stores wake up and read the disk.** Importing the app pulls in the
   Zustand stores. ``stores/profile.ts`` is wrapped in ``persist(...)``, so the
   moment it loads it reads your saved profiles from local storage. ``App.tsx``
   also builds the single React Query ``queryClient`` and registers it with
   ``setQueryClient()`` so non-React code can reach the same cache later.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts#L65>`__
   · → :doc:`03-state-management-zustand`

#. **Rehydration decides what kind of start this is.** Once persist finishes
   reading, ``stores/profile.ts`` fires ``onRehydrateStorage``, which calls
   ``handleProfileRehydration`` in ``services/profile-initialization.ts``. No
   saved profile sends you to the Profiles screen and stops; a valid one
   continues. Any error still flips ``isInitialized: true``, which guarantees the
   splash can never hang forever.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile-initialization.ts#L182>`__
   · → :doc:`11-application-lifecycle`

#. **Throw away last session's leftovers.** ``clearStaleState`` calls ``logout()``
   on the auth store and ``clearQueryCache()``. A persisted token or cached
   monitor list from a previous run must not be shown before we have
   re-authenticated this run, especially after switching servers.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile-initialization.ts#L92>`__
   · → :doc:`03-state-management-zustand`

#. **Point the HTTP client at this server.** ``initializeApiClient`` calls
   ``setApiClient(createStoreApiClient(profile.apiUrl, reLogin))``. From here on
   every ``httpGet`` / ``httpPost`` resolves through ``getApiClient()``, so this
   one call decides which server all later requests talk to. The ``reLogin``
   callback is what lets the client quietly re-authenticate a lapsed token.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile-initialization.ts#L108>`__
   · → :doc:`07-api-and-data-fetching`

#. **Let the user in (the important bit).** ``setInitializationState(true)``
   flips ``isInitialized`` and ``isBootstrapping``. This is the moment the UI
   becomes usable: the splash hides, routing renders, and the slow network setup
   is kicked off **without** being awaited, so it runs in the background. The app
   is interactive even while it is still logging in.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile-initialization.ts#L78>`__
   · → :doc:`11-application-lifecycle`

#. **Background setup, SSL trust first.** ``performBootstrap`` runs
   ``bootstrapSSLTrust`` before any network call. For a self-signed server it
   applies the trust override (and, the first time, shows the trust-on-first-use
   dialog) via ``lib/ssl-trust.ts`` ``applySSLTrustSetting``, dispatching to the
   native ``ssl-trust`` plugin or Electron. If trust were applied after the login
   call, a self-signed server would reject it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile-bootstrap.ts#L266>`__
   · → :doc:`13-network-endpoints`

#. **Log in.** ``bootstrapAuth`` decrypts the stored password and calls the auth
   store's ``login()``, which is single-flight (concurrent callers share one
   request) and POSTs to ``/host/login.json``. On success it stores the access
   and refresh tokens and sets ``isAuthenticated: true``. A failure here is only
   a warning, since some servers do not require auth. This is the step that
   produces the authenticated session.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile-bootstrap.ts#L21>`__
   · → :doc:`07-api-and-data-fetching`

#. **Fetch the server's shape.** Still in the background, ``performBootstrap``
   runs ``bootstrapServerMap`` (multi-server routing), ``bootstrapTimezone``,
   ``bootstrapZmsPath``, ``bootstrapGo2RTCPath``, and
   ``bootstrapMultiPortStreaming``, each wrapped on its own so one failure does
   not sink the rest, then clears ``isBootstrapping``. These resolve the streaming
   and routing details the monitor and montage views rely on.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile-bootstrap.ts#L303>`__
   · → :doc:`13-network-endpoints`

#. **Hide the splash, land on a page.** An effect in ``App.tsx`` hides the native
   splash once ``isInitialized`` is set, and ``AppRoutes`` navigates to your last
   route (or ``/monitors``) and starts the periodic token refresh
   (``useTokenRefresh``).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/App.tsx#L147>`__
   · → :doc:`04-pages-and-views`

#. **First real data.** ``pages/Monitors.tsx`` runs a React Query for the monitor
   list, keyed by profile and **gated on ``isAuthenticated``**, so it only fires
   after step 8 set the token. It polls at the bandwidth-profile interval. The
   rendered monitor list is what you finally see.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Monitors.tsx#L66>`__
   · → :doc:`07-api-and-data-fetching`

Switching profiles at runtime (``stores/profile.ts`` ``switchProfile``) converges
on this same ``performBootstrap``; it just tears down the old profile's streams
and resets the client first. That teardown is the last scene of Flow 2.

Flow 2: Montage opens and a live MJPEG stream runs
--------------------------------------------------

This is the busiest flow in the app and the one most worth understanding. A
montage tile goes from "just mounted" to a live ``nph-zms`` feed, and along the
way the app manages a **connection key** (connkey) per stream so feeds never
collide on the server and never leak a zombie process when they go away.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Page as Montage page
       participant Tile as Tile (LiveMonitorPlayer)
       participant Stream as useMonitorStream
       participant Life as useStreamLifecycle
       participant Store as Monitor store
       participant ZM as ZoneMinder (nph-zms)

       Page->>ZM: GET /monitors.json
       Page->>Tile: render one tile per filtered monitor
       Tile->>Stream: useMonitorStream (mjpeg)
       Stream->>Life: useStreamLifecycle
       Life->>Store: regenerateConnKey, get a unique key
       Stream->>ZM: img src = nph-zms?connkey=K
       ZM-->>Tile: MJPEG frames
       Note over Tile,ZM: on img error: backoff, CMD_QUIT old key, mint new key
       Tile->>ZM: CMD_QUIT on unmount or profile switch

#. **The page fetches its monitors.** ``pages/Montage.tsx`` runs the
   profile-scoped, bandwidth-throttled ``useQuery(['monitors', ...])`` for the
   list and live status the grid renders.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Montage.tsx#L61>`__
   · → :doc:`04-pages-and-views`

#. **Do not render until the filter is ready.** The page holds rendering behind
   ``isLoading || !isFilterReady``. This guard matters because mounting a tile
   starts a stream, so flashing the full monitor set for even one frame before
   the group/hidden filter narrows it would briefly open *every* stream at once.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Montage.tsx#L68>`__
   · → :doc:`04-pages-and-views`

#. **One tile per monitor.** Each monitor becomes a grid cell wrapping an error
   boundary and ``MontageMonitor`` (memoized), keyed by ``Monitor.Id``. ``memo``
   keeps grid re-renders (drag, resize) from tearing the stream down and back up,
   and the boundary isolates a crashing tile.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/MontageMonitor.tsx#L55>`__
   · → :doc:`05-component-architecture`

#. **Pick a streaming method.** ``LiveMonitorPlayer`` computes
   ``effectiveStreamingMethod`` (``webrtc`` vs ``mjpeg``) from the user setting,
   ``monitor.Go2RTCEnabled``, and ``profile.go2rtcUrl``; a go2rtc failure falls
   back to MJPEG. For a plain MJPEG monitor this is ``'mjpeg'`` and the rest of
   this flow follows the ``<img>`` path.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx#L151>`__
   · → :doc:`go2rtc-integration`

#. **The hook that owns the stream.** ``LiveMonitorPlayer`` calls
   ``useMonitorStream``, which resolves the profile, a fresh access token, the
   per-server URLs, the view mode, and the multi-port base. It assembles
   everything needed to build a valid stream URL and the matching CMD_QUIT URL.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useMonitorStream.ts#L74>`__
   · → :doc:`05-component-architecture`

#. **Mint a connection key.** ``useMonitorStream`` delegates the connkey
   lifecycle to ``useStreamLifecycle``, whose mount effect calls
   ``regenerateConnKey(monitorId)`` and sets ``connKey``. Each concurrent stream
   needs a unique key so ZoneMinder's ``nph-zms`` processes do not collide.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useStreamLifecycle.ts#L148>`__
   · → :doc:`12-shared-services-and-components`

#. **The key is stored, not just held.** ``stores/monitors.ts``
   ``generateAndSetConnKey`` generates a random number and stores it in the
   persisted ``connKeys[monitorId]`` map. Keeping it in the store is what lets
   teardown later compare-and-clear *exactly* the key it owns, never a newer
   concurrent one.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/monitors.ts#L15>`__
   · → :doc:`12-shared-services-and-components`

#. **Build the stream URL (only when safe).** Once ``connKey !== 0`` and the
   token is fresh, ``useMonitorStream`` builds the URL via ``getStreamUrl``
   (``api/monitors.ts`` then ``lib/url-builder.ts`` to ``/cgi-bin/nph-zms``) and
   mirrors it into ``imageSrc``. The double gate prevents minting a zombie stream
   before a key exists.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/monitors.ts#L296>`__
   · → :doc:`07-api-and-data-fetching`

#. **The browser opens the feed.** ``LiveMonitorPlayer`` binds
   ``<img src={imageSrc} onLoad onError>``. The browser itself opens the
   multipart MJPEG connection through the ``<img>``; the connkey lives right in
   the ``src``. A good frame calls ``reportStreamLoad``, which zeroes the
   reconnect backoff.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useMonitorStream.ts#L198>`__
   · → :doc:`05-component-architecture`

#. **When the feed drops, reconnect with backoff.** An ``<img onError>`` calls
   ``reportStreamError`` (``scheduleReconnect``), which waits an exponentially
   growing delay (capped, and uncapped under insomnia) then calls
   ``forceRegenerate({ killPrevious: true })``; at the attempt cap it calls
   ``releaseConnection()`` instead. The error cannot tell a dead server process
   from a dropped-but-alive one, so it must CMD_QUIT the old key before minting a
   new one.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useMonitorStream.ts#L170>`__
   · → :doc:`12-shared-services-and-components`

#. **Quit cleanly on every mint and unmount.** ``forceRegenerate`` (and the
   unmount cleanup ``quitStreamForParams``) send a CMD_QUIT for the old connkey
   and clear it from the store with a compare-and-clear, then the ``<img>`` src is
   removed to abort the in-flight connection. This is what prevents leaked
   ``nph-zms`` processes when a tile reconnects or leaves the grid.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useStreamLifecycle.ts#L315>`__
   · → :doc:`11-application-lifecycle`

#. **A profile switch tears down all streams first.** Each lifecycle registers a
   teardown thunk in ``lib/active-streams.ts``; ``stores/profile.ts``
   ``switchProfile`` awaits ``quitAllActiveStreams()`` before logout and the
   SSL-trust flip, while the old profile's trust and token are still in effect.
   Relying on React unmount alone races the switch and can orphan an ``nph-zms``
   process on a self-signed server.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/active-streams.ts#L32>`__
   · → :doc:`11-application-lifecycle`

Flow 3: A push notification, from registration to tap
-----------------------------------------------------

Native only (iOS/Android). Every ``@capacitor-firebase/messaging`` call sits
behind a ``Platform.isNative`` check and a dynamic ``import()``, so on web the
whole flow short-circuits and none of it runs. There are two halves: registering
a token on startup, and reacting when a push arrives.

.. mermaid::

   sequenceDiagram
       autonumber
       participant App as NotificationHandler
       participant Svc as Push service
       participant OS as FCM / OS
       participant ZM as ZoneMinder
       participant Nav as Router

       App->>Svc: initialize (on startup)
       Svc->>OS: request permission
       Svc->>OS: create channel zmninja-ng (Android)
       Svc->>OS: getToken
       OS-->>Svc: FCM token
       Svc->>ZM: register token (postForm /notifications.json)
       OS->>Svc: user taps a push (notificationActionPerformed)
       Svc->>Svc: resolve profile, store the event
       Svc->>Nav: navigate to /events/:id

#. **A headless component wires it all up.** ``App.tsx`` mounts
   ``<NotificationHandler/>`` once. It renders no UI of its own (only the
   cross-profile switch dialog) and exists purely to wire the notification side
   effects through three hooks.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/NotificationHandler.tsx#L43>`__
   · → :doc:`05-component-architecture`

#. **Set up push for the active profile.** ``useNotificationPushSetup`` runs an
   effect gated on ``Platform.isNative && settings.enabled``. It registers the
   token against the current profile and the chosen backend: re-register if the
   push service is already running, otherwise ``initialize()`` for the first
   time.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useNotificationPushSetup.ts#L25>`__
   · → :doc:`11-application-lifecycle`

#. **One push service for the whole app.** ``services/pushNotifications.ts``
   exposes ``getPushService``, a module-level singleton holding ``currentToken``
   and init state, so token state survives re-renders and profile switches
   instead of being recreated.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L586>`__
   · → :doc:`12-shared-services-and-components`

#. **Ask permission.** ``initialize`` imports ``FirebaseMessaging`` and calls
   ``requestPermissions()``, continuing only if granted. No token can be obtained
   without OS push permission.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L63>`__
   · → :doc:`12-shared-services-and-components`

#. **Create the Android channel.** ``_createNotificationChannel`` (Android only)
   creates the FCM channel ``id: 'zmninja-ng'`` at ``importance: 4`` (HIGH).
   Android needs a high-importance channel for heads-up banners, and the
   manifest's ``default_notification_channel_id`` routes channel-less server
   pushes here so they alert instead of landing silently.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L70>`__
   · → :doc:`12-shared-services-and-components`

#. **Listen before fetching the token.** ``_setupListeners`` registers
   ``tokenReceived``, ``notificationReceived``, and ``notificationActionPerformed``
   *before* ``getToken`` so a token refresh is never missed.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L75>`__
   · → :doc:`11-application-lifecycle`

#. **Get the FCM token.** ``getToken`` requests the token, stores it in
   ``currentToken``, and retries once after 5s on a transient failure.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L80>`__
   · → :doc:`12-shared-services-and-components`

#. **Register the token with the server.** ``_registerWithServer`` forks on
   ``settings.notificationMode``: direct mode calls ``api/notifications``
   ``registerToken``; ES mode registers over the websocket, deferring until
   connected.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L92>`__
   · → :doc:`07-api-and-data-fetching`

#. **The actual REST call.** ``api/notifications.ts`` ``registerToken`` POSTs a
   form-encoded ``Notification[...]`` body to ``/notifications.json`` via
   ``client.postForm``. ZoneMinder's notifications endpoint expects form fields,
   not JSON.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/notifications.ts#L35>`__
   · → :doc:`07-api-and-data-fetching`

#. **A push arrives while the app is open.** ``notificationReceived`` →
   ``_handleNotification`` ignores the push if already connected to the event
   server (the same event also arrives over the websocket), otherwise it builds a
   snapshot URL for the current profile and adds the event to the notification
   store.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L354>`__
   · → :doc:`03-state-management-zustand`

#. **The user taps the notification.** ``notificationActionPerformed`` →
   ``_handleNotificationAction`` resolves the target profile and stores the event
   under it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L367>`__
   · → :doc:`12-shared-services-and-components`

#. **Same profile or switch?** ``resolveProfileForNotification`` matches the
   payload's profile name to a stored profile. Same profile navigates directly; a
   different one calls ``requestProfileSwitch`` to ask first (the dialog lives in
   ``NotificationHandler``).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/notification-profile.ts#L32>`__
   · → :doc:`12-shared-services-and-components`

#. **Navigate to the event.** A service cannot use React Router's hook, so it
   calls ``navigationService.navigateToEvent``; ``NotificationHandler``'s listener
   catches that event and calls ``navigate``, landing on ``/events/:id``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/navigation.ts#L46>`__
   · → :doc:`12-shared-services-and-components`

#. **Reconcile pushes you missed.** ``useNotificationDelivered`` covers pushes
   that arrived while the app was killed or backgrounded: on cold start and on
   ``appStateChange`` it reads ``getDeliveredNotifications()``, ingests them into
   history, clears them, and syncs the badge.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useNotificationDelivered.ts#L62>`__
   · → :doc:`11-application-lifecycle`

These three flows touch most of the moving parts. When you need to change
something, find the nearest scene, open its ``source`` link, and follow the ``→``
link for the full picture.
