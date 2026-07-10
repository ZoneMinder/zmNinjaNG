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
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts#L68>`__
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
   dialog) via ``lib/security/ssl-trust.ts`` ``applySSLTrustSetting``, dispatching to the
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

#. **The page fetches its monitors.** ``pages/Montage.tsx`` runs a
   profile-scoped, bandwidth-throttled ``useQuery`` keyed by
   ``queryKeys.monitors(currentProfile?.id)`` for the list and live status the
   grid renders. A React Query cache entry belongs to a key, not to a component,
   so the app-wide ``staleTime`` that ``App.tsx`` sets on the ``queryClient``
   (``DEFAULT_QUERY_STALE_TIME_MS``, 15000 ms) keeps the last good response
   serving that key for 15 seconds and a remount during a network blip re-uses
   it. The ``refetchInterval`` above is untouched by that: the grid still polls
   on the bandwidth cadence.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Montage.tsx#L65>`__
   · → :doc:`04-pages-and-views`

#. **Do not render until the filter is ready.** The page holds rendering behind
   ``isLoading || !isFilterReady``. This guard matters because mounting a tile
   starts a stream, so flashing the full monitor set for even one frame before
   the group/hidden filter narrows it would briefly open *every* stream at once.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Montage.tsx#L284>`__
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
   (``api/monitors.ts`` then ``lib/zm/url-builder.ts`` to ``/cgi-bin/nph-zms``) and
   mirrors it into ``imageSrc``. The double gate prevents minting a zombie stream
   before a key exists. The reference treatment of this trap, and of the connkey
   lifecycle it protects, lives in :doc:`05-component-architecture`.
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
   teardown thunk in ``lib/monitor/active-streams.ts``; ``stores/profile.ts``
   ``switchProfile`` awaits ``quitAllActiveStreams()`` before logout and the
   SSL-trust flip, while the old profile's trust and token are still in effect.
   Relying on React unmount alone races the switch and can orphan an ``nph-zms``
   process on a self-signed server.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/monitor/active-streams.ts#L32>`__
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
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L629>`__
   · → :doc:`12-shared-services-and-components`

#. **Ask permission.** ``initialize`` imports ``FirebaseMessaging`` and calls
   ``requestPermissions()``, continuing only if granted. No token can be obtained
   without OS push permission.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L104>`__
   · → :doc:`12-shared-services-and-components`

#. **Create the Android channel.** ``_createNotificationChannel`` (Android only)
   creates the FCM channel ``id: 'zmninja-ng'`` at ``importance: 4`` (HIGH).
   Android needs a high-importance channel for heads-up banners, and the
   manifest's ``default_notification_channel_id`` routes channel-less server
   pushes here so they alert instead of landing silently.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L354>`__
   · → :doc:`12-shared-services-and-components`

#. **Listen before fetching the token.** ``_setupListeners`` registers
   ``tokenReceived``, ``notificationReceived``, and ``notificationActionPerformed``
   *before* ``getToken`` so a token refresh is never missed.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L370>`__
   · → :doc:`11-application-lifecycle`

#. **Get the FCM token.** Back in ``initialize``, ``FirebaseMessaging.getToken()``
   requests the token, stores it in ``currentToken``, and retries once after 5s on
   a transient failure. The service's own ``getToken()`` is only an accessor for
   that stored value.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L127>`__
   · → :doc:`12-shared-services-and-components`

#. **Register the token with the server.** ``_registerWithServer`` forks on
   ``settings.notificationMode``: direct mode calls ``api/notifications``
   ``registerToken``; ES mode registers over the websocket, deferring until
   connected.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L415>`__
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
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L479>`__
   · → :doc:`03-state-management-zustand`

#. **The user taps the notification.** ``notificationActionPerformed`` →
   ``_handleNotificationAction`` resolves the target profile and stores the event
   under it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/pushNotifications.ts#L545>`__
   · → :doc:`12-shared-services-and-components`

#. **Same profile or switch?** ``resolveProfileForNotification`` matches the
   payload's profile name to a stored profile. Same profile navigates directly; a
   different one calls ``requestProfileSwitch`` to ask first (the dialog lives in
   ``NotificationHandler``).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/profile/notification-profile.ts#L32>`__
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

Flow 4: Adding a server profile
-------------------------------

Adding a profile is one long orchestrated method, ``handleTestConnection``: it
discovers the server's real API and CGI URLs, trusts its certificate the first
time, logs in to confirm the details, then saves the profile and switches to it.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Form as ProfileForm
       participant Disc as Discovery
       participant SSL as SSL trust
       participant ZM as ZoneMinder
       participant Store as Profile store

       Form->>SSL: enable trust-all (if self-signed)
       Form->>Disc: discover URLs from the portal you typed
       Disc->>ZM: probe /api and /zm/api for getVersion
       Disc->>ZM: read ZM_PATH_ZMS for the real CGI URL
       Form->>SSL: fetch the cert fingerprint
       SSL-->>Form: show trust-on-first-use dialog
       Form->>ZM: log in to confirm
       Form->>Store: addProfile, then switchProfile

#. **The form.** ``ProfileForm`` holds state for the portal URL, credentials, the
   self-signed switch, manual-URL mode, and the trust-dialog. The same screen
   serves first-time setup and adding another profile.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/ProfileForm.tsx#L31>`__
   · → :doc:`04-pages-and-views`

#. **One method runs the whole thing.** ``handleTestConnection`` (the Connect
   button) sets up an ``AbortController``, validates the inputs, then drives
   discovery → trust → login → save → switch in order.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/ProfileForm.tsx#L132>`__
   · → :doc:`04-pages-and-views`

#. **Trust the cert before probing.** When self-signed is on, ``applySSLTrustSetting``
   enables trust-all first, so the upcoming discovery calls can reach a
   self-signed host instead of failing the handshake.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/security/ssl-trust.ts#L18>`__
   · → :doc:`12-shared-services-and-components`

#. **Find the real URLs.** ``discoverUrls`` wraps ``discoverZoneminder`` with one
   retry (to absorb the iOS local-network permission prompt) and installs the API
   client once a candidate answers.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/discovery.ts#L330>`__
   · → :doc:`07-api-and-data-fetching`

#. **Probe candidates.** ``discoverZoneminder`` crosses ``https``/``http`` with
   ``/api`` and ``/zm/api``, probing ``host/getVersion.json``, then derives the
   portal URL and CGI URL from whichever responds.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/discovery.ts#L250>`__
   · → :doc:`07-api-and-data-fetching`

#. **Read the server's ZMS path.** With credentials, ``fetchCgiUrl`` logs in and
   reads ``ZM_PATH_ZMS`` from config, so the streaming URL matches the server's
   real setup rather than a guess.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/discovery.ts#L170>`__
   · → :doc:`13-network-endpoints`

#. **Trust on first use.** On native with self-signed enabled,
   ``getServerCertFingerprint`` fetches the cert; ``CertTrustDialog`` shows it and
   waits. Accepting pins the fingerprint (``applySSLTrustSetting(true,
   fingerprint)``); rejecting aborts.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/CertTrustDialog.tsx#L13>`__
   · → :doc:`05-component-architecture`

#. **Confirm with a login.** After a fresh ``logout()``, the auth store's
   ``login()`` authenticates against the confirmed server; failure is surfaced as
   a localized error.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/auth.ts#L246>`__
   · → :doc:`11-application-lifecycle`

#. **Save it.** ``addProfile`` validates the name, generates a UUID, writes the
   password to secure storage (never to Zustand), appends the profile, and makes
   it current if it is the first.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts#L96>`__
   · → :doc:`11-application-lifecycle`

#. **Switch to it.** For a non-first profile, ``switchProfile`` quits the old
   profile's streams, resets the client, and runs ``performBootstrap`` (the same
   bootstrap as Flow 1) before navigating away.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts#L250>`__
   · → :doc:`11-application-lifecycle`

Flow 5: Browse events and play a video
--------------------------------------

From the Events list to a playing video. The player choice is data-driven: an
event whose ``DefaultVideo`` is an ``.m3u8`` plays HLS, a normal recording plays
MP4, and anything else (or any MP4 error, or a TV device) falls back to the ZMS
MJPEG player.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Page as Events page
       participant API as getEvents
       participant ZM as ZoneMinder
       participant Detail as EventDetail
       participant Player as Video player

       Page->>API: query with the active filters
       API->>ZM: GET /events/index...json (paged)
       ZM-->>Page: event list, rendered as thumbnail cards
       Page->>Detail: tap a card, navigate to /events/:id
       Detail->>ZM: GET /events/:id.json
       Detail->>Detail: pick MP4 vs HLS vs ZMS
       Detail->>Player: build the video URL and play
       Player->>ZM: stream from /index.php or /cgi-bin/nph-zms

#. **Assemble the filters.** ``Events`` reads monitor, date, tag, and favorite
   filters from ``useEventFilters`` and computes the effective monitor set that
   drives the query.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Events.tsx#L90>`__
   · → :doc:`04-pages-and-views`

#. **Run the events query.** A React Query keyed by
   ``queryKeys.eventsList(...)`` calls ``getEvents``, keeping the previous page
   visible during pagination (``placeholderData: keepPreviousData``), gated on
   auth. Its error wall is guarded by ``error && !eventsData``: once a page of
   events is cached, a failed background refetch leaves the stale list on screen
   rather than replacing it. Only a cold start with nothing cached renders
   ``ErrorBanner`` with ``resolveQueryError(error, t)``, which folds a 401 into
   the localized ``common.auth_required`` message instead of leaking the raw
   error text. ``pages/Montage.tsx`` and ``pages/Monitors.tsx`` guard the same way.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Events.tsx#L208>`__
   · → :doc:`07-api-and-data-fetching`

#. **Build the ZM filter path and paginate.** ``getEvents`` turns filters into
   CakePHP-style URL segments, fetches up to ten pages of 100, dedupes by id,
   drops excluded monitors, and returns a synthesized pagination block.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/events.ts#L43>`__
   · → :doc:`07-api-and-data-fetching`

#. **Render thumbnail cards.** ``EventListView`` maps each event to an
   ``EventCard``, each showing a representative still built from a fallback chain
   of frame ids (snapshot/objdetect/alarm).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/events/EventListView.tsx#L90>`__
   · → :doc:`05-component-architecture`

#. **Open one.** Tapping a card navigates to ``/events/:id``, carrying the
   referrer and active filters in router state so the detail page can do
   next/prev within the same filtered set.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/events/EventCard.tsx#L93>`__
   · → :doc:`04-pages-and-views`

#. **Load the event.** ``EventDetail`` fetches the full event (``getEvent``) and
   its monitor, and resolves the monitor's portal URL and streaming port for
   multi-server support.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/EventDetail.tsx#L73>`__
   · → :doc:`04-pages-and-views`

#. **Pick the player.** ``isHlsEvent`` (an ``.m3u8`` ``DefaultVideo``) chooses HLS;
   otherwise MP4. JPEG-only events, TV devices, and any MP4 error flip
   ``useZmsFallback`` to the ZMS player; it is seeded from ``isTvMode`` at the top
   of the component so a Fire Stick never even attempts the MP4 path.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/EventDetail.tsx#L201>`__
   · → :doc:`04-pages-and-views`

#. **Build the video URL (stably).** ``videoUrl`` is memoized so its identity does
   not change mid-playback (re-issuing the source resets iOS WKWebView); it calls
   ``getEventVideoUrl`` with the token, port, and HLS flag.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/EventDetail.tsx#L209>`__
   · → :doc:`07-api-and-data-fetching`

#. **The URL shape.** ``url-builder.ts`` ``getEventVideoUrl`` emits the HLS
   (``view_event_hls``) or MP4 (``view_video``) ``/index.php`` URL, appends the
   token, and rewrites the port when multi-port streaming is on.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/zm/url-builder.ts#L285>`__
   · → :doc:`10-key-libraries`

#. **MP4/HLS playback.** ``Mp4EventPlayer`` creates a Video.js player, wires alarm
   markers and PiP, and bubbles a playback ``error`` up to ``EventDetail``, which
   switches to ZMS.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/events/Mp4EventPlayer.tsx#L52>`__
   · → :doc:`05-component-architecture`

#. **The ZMS fallback.** ``ZmsEventPlayer`` streams MJPEG from ``/cgi-bin/nph-zms``
   into an ``<img>`` and sends play/pause/seek/speed as ZMS commands over the same
   connkey, quitting on unmount, just like a live stream.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/events/ZmsEventPlayer.tsx#L51>`__
   · → :doc:`05-component-architecture`

Flow 6: The access-token lifecycle
----------------------------------

The app keeps the access token fresh two ways and recovers from a stale one a
third way, and all three collapse to a single network request when they overlap.
A timer refreshes proactively, each request refreshes just-in-time if needed, and
a 401 triggers recovery, all behind module-level single-flight gates.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Timer as useTokenRefresh
       participant Auth as Auth store (gates)
       participant ZM as ZoneMinder
       participant Client as API client

       Timer->>Auth: token expiring soon? getFreshAccessToken
       Auth->>ZM: POST refresh (single-flight)
       ZM-->>Auth: new tokens
       Client->>Auth: getAccessToken before each request
       Client->>Auth: expired? getFreshAccessToken (shares the same gate)
       Client->>ZM: request with token
       ZM-->>Client: 401
       Client->>Auth: recoverFromAuthFailure (refresh, then re-login)
       Client->>ZM: retry once

#. **A minute timer watches expiry.** ``useTokenRefresh`` mounts once, arms a
   one-minute interval and a ``visibilitychange`` listener so it re-checks the
   moment the app returns from background.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useTokenRefresh.ts#L26>`__
   · → :doc:`11-application-lifecycle`

#. **Refresh before it lapses.** ``checkAndRefresh`` refreshes when the time to
   expiry drops below the leeway window, covering both "expiring soon" and
   "already expired while backgrounded".
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useTokenRefresh.ts#L35>`__
   · → :doc:`11-application-lifecycle`

#. **One shared entry point.** ``getFreshAccessToken`` returns the current token if
   still fresh, else attaches to (or installs) the module-level ``pendingFreshToken``
   gate, so concurrent callers share one outcome.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/auth.ts#L388>`__
   · → :doc:`03-state-management-zustand`

#. **The deduped refresh POST.** ``refreshAccessToken`` runs the network refresh
   behind its own ``pendingRefresh`` gate and logs out if the refresh token is
   already expired, so a proactive refresh and a 401 recovery collapse to one POST.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/auth.ts#L305>`__
   · → :doc:`03-state-management-zustand`

#. **New tokens land.** ``setTokens`` converts the relative expiry seconds to
   absolute timestamps and stores them (access in memory, refresh in secure
   storage); updating the expiry is what re-arms the timer.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/auth.ts#L342>`__
   · → :doc:`03-state-management-zustand`

#. **Every request reads the token through a gate.** The API client's ``request``
   pulls the token via the injected ``AuthGate`` rather than importing the store;
   login and ``skipAuth`` requests bypass it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/client.ts#L128>`__
   · → :doc:`07-api-and-data-fetching`

#. **Just-in-time refresh.** If the token is already expired when a request is
   about to fire, the client calls ``getFreshAccessToken`` (the same gate) and
   attaches the new token, catching tokens that died between timer ticks.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/client.ts#L169>`__
   · → :doc:`07-api-and-data-fetching`

#. **401 recovery, single-flight.** A 401 triggers ``recoverFromAuthFailure``,
   which refreshes, falls back to re-login, logs out once if both fail, never
   rejects, and on success retries the original request exactly once.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/client.ts#L228>`__
   · → :doc:`07-api-and-data-fetching`

#. **The gate that breaks the import cycle.** ``storeGates`` injects the auth
   accessors into the client so it never imports the store directly, keeping all
   the single-flight dedup in the store and the client mockable.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/store-gates.ts#L20>`__
   · → :doc:`12-shared-services-and-components`

#. **A switch clears the gates.** ``resetAuthGates`` (a reset hook run by
   ``resetApiClient``) nulls all five pending gates so a new profile never attaches
   to an old profile's in-flight login or refresh.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/auth.ts#L213>`__
   · → :doc:`12-shared-services-and-components`

Flow 7: Live notifications over the Event Server websocket
----------------------------------------------------------

The other notification path (separate from FCM push in Flow 3): in "ES mode" the
app opens a websocket to the ZoneMinder event server, authenticates, keeps it
alive, and turns each live alarm into an event in the store and a toast on screen.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Hook as Auto-connect hook
       participant Store as Notification store
       participant Svc as WS service
       participant ES as Event server

       Hook->>Store: connect(profile, user, pass)
       Store->>Svc: connect + inject providers
       Svc->>ES: open websocket, send auth
       ES-->>Svc: auth Success
       Svc->>ES: keepalive ping (bandwidth interval)
       ES-->>Svc: alarm event
       Svc->>Store: onEvent, addEvent
       Store-->>Hook: toast + badge update

#. **The handler wires the hook.** ``NotificationHandler`` hands the store's
   ``connect``/``disconnect``/``reconnect`` and the current profile to
   ``useNotificationAutoConnect``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/NotificationHandler.tsx#L43>`__
   · → :doc:`05-component-architecture`

#. **Choose the ES path.** The auto-connect effect reads ``notificationMode``; for
   ``es`` it proceeds only when a host is set and nothing is connected, guarded
   against re-entry.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useNotificationAutoConnect.ts#L82>`__
   · → :doc:`11-application-lifecycle`

#. **Decrypt and connect (race-checked).** ``attemptConnect`` decrypts the
   password, re-reads the connection state right before connecting (the await
   could have changed it), then calls the store's ``connect``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useNotificationAutoConnect.ts#L120>`__
   · → :doc:`11-application-lifecycle`

#. **Store builds the config and listeners.** ``connect`` disconnects any other
   profile, builds the server config, registers state/event listeners, and awaits
   the service connect.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/notifications.ts#L254>`__
   · → :doc:`03-state-management-zustand`

#. **Inject store-derived providers.** ``_buildServiceProviders`` hands the
   import-free service its token getter, image-URL builder, and bandwidth-derived
   keepalive interval.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/notifications.ts#L674>`__
   · → :doc:`12-shared-services-and-components`

#. **Open the socket.** The service ``connect`` builds the ``ws(s)://host:port``
   URL, opens the websocket with stale-socket guards on every handler, and waits
   for auth.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/notifications.ts#L68>`__
   · → :doc:`12-shared-services-and-components`

#. **Send credentials on open.** ``_handleOpen`` sends the ``auth`` message and a
   20-second timer rejects (and reconnects) if no response comes back.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/notifications.ts#L387>`__
   · → :doc:`13-network-endpoints`

#. **Handle the auth reply.** ``_handleMessage`` resolves the pending auth on
   ``Success`` (starts keepalive, state ``connected``) or disconnects without
   reconnect on bad credentials.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/notifications.ts#L407>`__
   · → :doc:`13-network-endpoints`

#. **Keep it alive.** ``_startPingInterval`` sends a periodic version request at the
   bandwidth-derived interval; the same request backs the liveness check on resume.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/notifications.ts#L583>`__
   · → :doc:`12-shared-services-and-components`

#. **Reconnect with backoff.** On an unintended close, ``_scheduleReconnect`` waits
   an exponential, jittered delay (capped at two minutes); ``reconnectNow`` jumps
   the queue on network-restored.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/notifications.ts#L518>`__
   · → :doc:`12-shared-services-and-components`

#. **Bridge events into the store.** ``_initialize`` subscribes to the service's
   state and event streams, mirroring connection state and calling ``addEvent`` per
   alarm.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/notifications.ts#L473>`__
   · → :doc:`03-state-management-zustand`

#. **Record the alarm.** ``addEvent`` wraps it as a notification, dedupes and caps
   the history, recomputes the unread badge, and pushes the count back to the
   server. A toast then shows for the latest event.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/notifications.ts#L350>`__
   · → :doc:`03-state-management-zustand`

Flow 8: A go2rtc WebRTC live stream
-----------------------------------

The alternative to the MJPEG tile in Flow 2. When a monitor has go2rtc enabled,
the tile drives a low-latency WebRTC/MSE ``<video>`` via the vendored ``video-rtc``
element, with a ladder of watchdogs that fall back to MJPEG if anything stalls.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Tile as LiveMonitorPlayer
       participant Hook as useGo2RTCStream
       participant El as video-rtc element
       participant GR as go2rtc server

       Tile->>Tile: webrtc selected? (not failed recently)
       Tile->>Hook: useGo2RTCStream
       Hook->>El: new VideoRTC, src = ws URL
       El->>GR: open websocket, negotiate webrtc/mse/hls
       GR-->>El: video frames
       Note over Tile,GR: no frames in 15s, or freeze, or error
       Tile->>Tile: record failure, fall back to MJPEG

#. **Choose WebRTC.** ``streamingMethod`` resolves ``webrtc`` only when the user
   setting allows it, the monitor has go2rtc enabled, and the profile has a go2rtc
   URL.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx#L104>`__
   · → :doc:`05-component-architecture`

#. **Skip known-broken monitors.** A module-level failure cache (5-minute TTL)
   makes a monitor that recently failed go2rtc go straight to MJPEG, so montage
   tiles do not each re-attempt a broken stream.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx#L36>`__
   · → :doc:`05-component-architecture`

#. **MJPEG-first placeholder.** ``effectiveStreamingMethod`` shows the MJPEG stream
   as a placeholder while WebRTC establishes, swapping to ``<video>`` once decoded
   frames appear, so the tile is never blank.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx#L151>`__
   · → :doc:`05-component-architecture`

#. **Call the hook.** ``useGo2RTCStream`` is invoked with the go2rtc URL, channel,
   protocols, and a host guard against leaking the token to the wrong origin.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx#L167>`__
   · → :doc:`05-component-architecture`

#. **Connect lifecycle.** The hook waits a short delay (to survive Strict-Mode
   double-invoke) then connects, and tears down on unmount or disable.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useGo2RTCStream.ts#L297>`__
   · → :doc:`11-application-lifecycle`

#. **Build the websocket URL.** ``getGo2RTCWebSocketUrl`` converts http(s) to
   ws(s), appends ``/ws``, and sets ``src={monitorId}_{channel}`` plus the token.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/zm/url-builder.ts#L449>`__
   · → :doc:`07-api-and-data-fetching`

#. **Create the element.** ``connect`` instantiates ``VideoRTC``, wraps its
   ``oninit``/``onopen``/``ondisconnect`` handlers into React state, and assigns
   ``src`` to kick off the socket. It also overwrites the ``pcConfig.iceServers``
   the vendored file hardcodes, with ``GO2RTC_STUN_SERVERS`` or an empty list
   depending on the per-profile ``webrtcUseStun`` setting (off by default, since
   LAN and VPN clients reach go2rtc on host candidates). The override has to
   happen here rather than during negotiation: ``onwebrtc()`` reads ``pcConfig``
   only when it builds the peer connection, after the websocket has opened.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useGo2RTCStream.ts#L164>`__
   · → :doc:`12-shared-services-and-components`

#. **Negotiate protocols.** On open, the vendored element starts MSE (or HLS) and
   WebRTC in parallel; whichever delivers video first wins and becomes the active
   protocol.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/vendor/go2rtc/video-rtc.js#L334>`__
   · → :doc:`go2rtc-integration`

#. **Watchdog: connected but no frames.** A 15-second timer checks for actual video
   dimensions; if none, it records the failure and falls back to MJPEG (a faster
   poll swaps to ``<video>`` the instant frames appear).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx#L201>`__
   · → :doc:`05-component-architecture`

#. **Watchdog: freeze after playing.** A 3-second liveness check watches
   ``currentTime`` advance; a stall past the threshold retries up to twice, then
   demotes to MJPEG. Healthy playback for a minute clears the retry count.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx#L281>`__
   · → :doc:`05-component-architecture`

#. **Resume after background.** ``useVisibilityResume`` resets freeze counters,
   clears any latched MJPEG fallback, and nudges a retry, recovering tiles the
   browser suspended.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx#L377>`__
   · → :doc:`11-application-lifecycle`

Flow 9: The Timeline view
-------------------------

The Timeline fetches events for a time range, transforms them into bars, and
paints them on a ``<canvas>`` you can pan, zoom, and scrub, with live events
injected the instant they arrive.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Page as Timeline page
       participant Data as useTimelineData
       participant ZM as ZoneMinder
       participant Canvas as TimelineCanvas
       participant Render as renderer

       Page->>Data: fetch monitors + events for the range
       Data->>ZM: GET events (fan out per monitor if filtered)
       ZM-->>Data: events, transformed to bars
       Data->>Page: live events injected from the store
       Page->>Canvas: viewport + gestures
       Canvas->>Render: paint axis, swimlanes, bars, playhead

#. **The page and its range.** ``Timeline`` reads filters, defaults to the last 24
   hours, and restores the scrubber from session storage so the playhead survives
   a round-trip to an event page.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Timeline.tsx#L27>`__
   · → :doc:`04-pages-and-views`

#. **Fetch monitors and events.** ``useTimelineData`` runs a monitors query and a
   range-bounded events query, using "now" as the end in live mode.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useTimelineData.ts#L41>`__
   · → :doc:`07-api-and-data-fetching`

#. **Fan out per monitor when filtered.** With a cause filter active, it issues one
   capped ``getEvents`` per monitor at limited concurrency and merges them, so one
   busy camera cannot eat the whole page budget.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useTimelineData.ts#L92>`__
   · → :doc:`07-api-and-data-fetching`

#. **Inject live events.** In live mode it subscribes to the notification store and
   adds a synthetic bar immediately on a new alarm, then debounces a refetch and
   prunes the synthetic once the real event lands.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useTimelineData.ts#L154>`__
   · → :doc:`07-api-and-data-fetching`

#. **Transform to bars.** ``allTimelineEvents`` maps each event to a
   ``TimelineEvent`` (start/end ms, alarm ratio, pulse timestamp), merging live
   synthetics with the API winning on id collisions.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useTimelineData.ts#L217>`__
   · → :doc:`05-component-architecture`

#. **The canvas orchestrator.** ``TimelineCanvas`` wires the viewport, gestures,
   render loop, and hit-testing, translating one-shot actions (reset, zoom, go-to-now)
   into animated viewport changes.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/timeline/TimelineCanvas.tsx#L62>`__
   · → :doc:`05-component-architecture`

#. **Viewport math.** ``useTimelineViewport`` holds the visible range and does pan,
   zoom (clamped between one minute and 90 days), and eased animations.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/timeline/useTimelineViewport.ts#L32>`__
   · → :doc:`05-component-architecture`

#. **Input gestures.** ``useTimelineGestures`` normalizes mouse, touch, wheel, and
   pinch into pan/zoom/hover/click/brush callbacks.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/timeline/useTimelineGestures.ts#L27>`__
   · → :doc:`05-component-architecture`

#. **Hit-testing.** ``hitTest`` maps a canvas point to a monitor row and event,
   expanding thin bars to a minimum width so they stay clickable.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/timeline/timeline-hit-test.ts#L13>`__
   · → :doc:`12-shared-services-and-components`

#. **Paint the canvas.** ``renderTimeline`` layers swimlanes, a collision-pruned
   time axis, rounded per-monitor event bars (with a pulse halo for live arrivals),
   the dashed "NOW" pill, and the scrubber playhead.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/timeline/timeline-renderer.ts#L640>`__
   · → :doc:`10-key-libraries`

#. **Scrub and preview.** ``TimelineScrubber`` drags the playhead and shows
   thumbnail buttons for the events under it; a canvas click opens
   ``EventPreviewPopover``, whose Play button navigates to the event.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/timeline/TimelineScrubber.tsx#L144>`__
   · → :doc:`05-component-architecture`

Flow 10: Downloading an event
-----------------------------

A download registers a background task and then splits by platform: on mobile it
fetches base64 and writes via Capacitor (never a Blob, to avoid OOM); on web it
streams a Blob with real progress. The drawer shows progress and a cancel button.

.. mermaid::

   sequenceDiagram
       autonumber
       participant UI as Download button
       participant Svc as download service
       participant Task as Background-task store
       participant HTTP as http adapter
       participant Save as Filesystem / Media
       participant Drawer as Task drawer

       UI->>Svc: downloadEventVideo
       Svc->>Task: addTask (drawer pops open)
       Svc->>HTTP: fetch (base64 on mobile, Blob on web)
       HTTP->>Save: write file + add to media library
       Svc->>Task: updateProgress, then completeTask
       Task-->>Drawer: progress bar + cancel

#. **The trigger.** The "Download video" button calls ``downloadEventVideo`` with
   the URL inputs and returns immediately; the drawer surfaces progress.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/EventDetail.tsx#L379>`__
   · → :doc:`05-component-architecture`

#. **Orchestrate and register a task.** ``downloadEventVideo`` builds the URL,
   sanitizes the filename, creates an ``AbortController``, registers a background
   task with a cancel function, and kicks off the work asynchronously.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts#L379>`__
   · → :doc:`12-shared-services-and-components`

#. **The task store.** ``addTask`` creates the task, trims old finished ones, and
   auto-expands the drawer. Using ``.getState()`` is what lets a non-React service
   drive the store.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/backgroundTasks.ts#L75>`__
   · → :doc:`03-state-management-zustand`

#. **Platform dispatch.** ``downloadFile`` picks the native or web handler from the
   platform; this is the split point.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts#L121>`__
   · → :doc:`12-shared-services-and-components`

#. **Mobile: base64, never a Blob.** ``downloadFileNative`` fetches with
   ``responseType: 'base64'`` and uses the string directly, explicitly avoiding a
   Blob to prevent out-of-memory on large videos.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts#L135>`__
   · → :doc:`12-shared-services-and-components`

#. **The native HTTP adapter.** ``nativeHttpRequest`` uses CapacitorHttp and returns
   base64; it has no abort support, so a timeout race stands in.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/http/adapter-native.ts#L14>`__
   · → :doc:`07-api-and-data-fetching`

#. **Mobile save.** The base64 is written to Documents, then added to the Photo or
   Video library by extension; a media-library failure is non-fatal because the
   file is already saved.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts#L169>`__
   · → :doc:`12-shared-services-and-components`

#. **Web: streaming Blob.** ``downloadFileWeb`` fetches a Blob with streaming
   progress and triggers a browser download via a temporary anchor, falling back to
   a direct link if the fetch fails.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts#L198>`__
   · → :doc:`12-shared-services-and-components`

#. **Progress feeds the store.** Each tick calls ``updateProgress`` (web has real
   streaming progress; native emits a single 100% tick), then ``completeTask`` /
   ``failTask`` on finish.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/backgroundTasks.ts#L93>`__
   · → :doc:`03-state-management-zustand`

#. **The drawer.** ``BackgroundTaskDrawer`` (mounted globally) renders progress bars
   and a cancel button that calls the task's cancel function, which aborts the
   request.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/BackgroundTaskDrawer.tsx#L143>`__
   · → :doc:`05-component-architecture`

Flow 11: A bandwidth setting becomes polling cadence
----------------------------------------------------

This is a data-propagation flow, not a time sequence: one per-profile setting
(``bandwidthMode``) selects a preset, and every poll in the app reads its interval
from that one place, so flipping low mode re-cadences the whole app at once.

.. mermaid::

   graph LR
       Presets["BANDWIDTH_SETTINGS<br/>(normal / low)"] --> Getter["getBandwidthSettings()"]
       Mode["bandwidthMode<br/>(per-profile setting)"] --> Hook["useBandwidthSettings()"]
       Getter --> Hook
       Hook --> C1["useMonitors<br/>refetchInterval"]
       Hook --> C2["Monitors page<br/>queries"]
       Getter --> C3["notifications<br/>keepalive / poller"]

#. **The contract.** ``BandwidthSettings`` declares the shape: every interval and
   quality knob the app polls on (monitor status, alarm status, snapshot refresh,
   keepalive, and more).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/zmninja-ng-constants.ts#L499>`__
   · → :doc:`12-shared-services-and-components`

#. **The two presets.** ``BANDWIDTH_SETTINGS`` holds the ``normal`` and ``low``
   objects; ``low`` roughly doubles every interval and halves image scale and fps.
   This is the source of every cadence number.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/zmninja-ng-constants.ts#L536>`__
   · → :doc:`12-shared-services-and-components`

#. **The non-React getter.** ``getBandwidthSettings(mode)`` is the one sanctioned
   way for services and stores (outside React) to read a preset.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/zmninja-ng-constants.ts#L574>`__
   · → :doc:`12-shared-services-and-components`

#. **The user's knob.** ``bandwidthMode`` is a profile-scoped setting in the
   settings store, so switching profiles can switch cadence.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/settings.ts#L148>`__
   · → :doc:`03-state-management-zustand`

#. **The React hook.** ``useBandwidthSettings`` reads ``bandwidthMode`` from the
   current profile and memoizes the matching preset, so components get a live,
   profile-correct settings object.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useBandwidthSettings.ts#L28>`__
   · → :doc:`05-component-architecture`

#. **A typical consumer.** ``useMonitors`` feeds ``bandwidth.monitorStatusInterval``
   straight into the React Query ``refetchInterval`` (overridable by the caller).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useMonitors.ts#L57>`__
   · → :doc:`07-api-and-data-fetching`

#. **The seeded path.** Toggling low mode in ``LiveStreamingSection`` copies the
   preset's stream knobs (scale, fps, snapshot refresh) into the profile settings,
   which is why ``useMonitorStream`` reads them as ``settings.*``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/settings/LiveStreamingSection.tsx#L47>`__
   · → :doc:`03-state-management-zustand`

#. **The non-React consumers.** Outside React, the notification keepalive and the
   direct-mode poller call ``getBandwidthSettings`` directly for their intervals,
   the same presets without a hardcoded number anywhere.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/notifications.ts#L682>`__
   · → :doc:`03-state-management-zustand`

Flow 12: A Dashboard widget
---------------------------

The Dashboard is a per-profile grid of widgets you add, arrange, and resize. The
layout lives in its own persisted store (not profile settings), keyed by profile
id, and each widget fetches its own live data.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Page as Dashboard page
       participant Store as Dashboard store
       participant Grid as DashboardLayout
       participant Widget as A widget
       participant ZM as ZoneMinder

       Page->>Store: read widgets[profileId]
       Store-->>Grid: saved widgets + layouts
       Grid->>Widget: render each by type
       Widget->>ZM: query its own data on an interval
       Page->>Store: add / move / resize / remove
       Store-->>Page: persisted, survives reload

#. **The page reads the saved list.** ``Dashboard`` resolves the current profile
   and pulls that profile's widgets from the dashboard store, falling back to an
   empty array.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Dashboard.tsx#L23>`__
   · → :doc:`04-pages-and-views`

#. **A dedicated persisted store.** ``useDashboardStore`` keeps
   ``widgets: Record<profileId, DashboardWidget[]>`` plus an editing flag, persisted
   under its own key with versioned migrations. It is profile-scoped by keying on
   profile id, not by ``getProfileSettings``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/dashboard.ts#L49>`__
   · → :doc:`03-state-management-zustand`

#. **The grid.** ``DashboardLayout`` maps each widget's stored geometry into a
   react-grid-layout and packs widgets upward, showing an empty state when there
   are none.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/dashboard/DashboardLayout.tsx#L31>`__
   · → :doc:`05-component-architecture`

#. **Card chrome per cell.** ``DashboardWidget`` wraps each cell in a card with the
   drag handle and, in edit mode, the per-widget edit and delete buttons; the live
   content is passed in by type.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/dashboard/DashboardWidget.tsx#L52>`__
   · → :doc:`05-component-architecture`

#. **Add a widget.** ``DashboardConfig`` opens the Add Widget dialog with four type
   tiles (monitor, events, timeline, heatmap) and the per-type options (monitor
   multi-select, feed fit, and so on).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/dashboard/DashboardConfig.tsx#L40>`__
   · → :doc:`05-component-architecture`

#. **The store appends and auto-places it.** ``addWidget`` generates a UUID,
   computes a ``y`` below the existing widgets so it stacks, and persists
   immediately so it survives a reload.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/dashboard.ts#L55>`__
   · → :doc:`03-state-management-zustand`

#. **A widget fetches its own data.** ``EventsWidget`` runs a React Query against
   ``getEvents`` with its ``refetchInterval`` drawn from the widget override or
   ``bandwidth.eventsWidgetInterval`` (never a hardcoded interval), then renders a
   clickable list.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/dashboard/widgets/EventsWidget.tsx#L41>`__
   · → :doc:`07-api-and-data-fetching`

#. **Drag and resize persist.** ``handleLayoutChange`` fires on every move, and only
   while editing (guarded against a store→state→store feedback loop) writes the new
   geometry back. The reference treatment of that feedback loop, and of the
   subscription rules that keep it from re-arming, lives in
   :doc:`05-component-architecture`.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/dashboard/DashboardLayout.tsx#L97>`__
   · → :doc:`05-component-architecture`

#. **Per-breakpoint layout write.** ``updateLayouts`` merges the new geometry per
   breakpoint and recomputes the primary layout, so a resized widget keeps its size
   across reloads.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/dashboard.ts#L111>`__
   · → :doc:`03-state-management-zustand`

#. **Remove a widget.** The edit-mode X button calls ``removeWidget``, which filters
   it out of that profile's array and re-renders the grid.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/dashboard.ts#L93>`__
   · → :doc:`03-state-management-zustand`

Flow 13: Kiosk lock and biometric unlock
----------------------------------------

A wall-display lock: a full-screen overlay, protected by a global PIN, with
biometric unlock on mobile. There is one feature here, not two; the lock is
triggered only by a manual tap and resets to unlocked on app restart. There is no
idle timeout and no auto-lock on backgrounding.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Btn as Lock button
       participant Store as Kiosk store
       participant Overlay as KioskOverlay
       participant Bio as Biometrics
       participant Pin as PinPad

       Btn->>Store: lock() (manual)
       Store-->>Overlay: isLocked, mount full-screen gate
       Overlay->>Bio: try biometrics on unlock tap
       Bio-->>Overlay: success unlocks
       Overlay->>Pin: on unavailable / cancel, show PIN
       Pin->>Store: verifyPin, count failed attempts
       Store-->>Overlay: unlock (or 30s cooldown after 5 misses)

#. **Set the PIN.** ``AdvancedSection`` hosts setting, changing, and clearing the
   global kiosk PIN, each gated behind biometric-then-PIN re-verification.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/settings/AdvancedSection.tsx#L52>`__
   · → :doc:`04-pages-and-views`

#. **The PIN secret.** ``kioskPin.ts`` stores a salted SHA-256 of the PIN in secure
   storage and verifies against it; this is the single source of truth for whether a
   PIN is configured.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/kioskPin.ts#L27>`__
   · → :doc:`12-shared-services-and-components`

#. **The lock-state store.** ``useKioskStore`` holds ``isLocked``, the failed-attempt
   count, and a cooldown timestamp. It is not persisted, so locking does not survive
   a restart.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/kioskStore.ts#L26>`__
   · → :doc:`03-state-management-zustand`

#. **Activating the lock.** ``useKioskLock`` is the shared logic behind the lock
   buttons: with no PIN it opens first-time setup, otherwise it locks and force-enables
   screen keep-awake (restoring the prior value on unlock).
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useKioskLock.ts#L22>`__
   · → :doc:`05-component-architecture`

#. **The trigger.** The sidebar lock button calls that hook to lock, or signals the
   overlay to begin unlock when already locked. The fullscreen montage controls
   expose the same button.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/layout/SidebarContent.tsx#L406>`__
   · → :doc:`05-component-architecture`

#. **The gate.** ``KioskOverlay`` renders nothing until locked, then mounts a
   full-screen overlay that captures pointer events, swallows keyboard shortcuts, and
   blocks browser and Android hardware back. The live view keeps updating underneath.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/kiosk/KioskOverlay.tsx#L26>`__
   · → :doc:`05-component-architecture`

#. **Unlock: biometric first.** ``handleUnlockTap`` checks the cooldown, tries
   biometrics, and unlocks on success; if biometrics are unavailable or cancelled it
   falls through to the PIN pad.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/kiosk/KioskOverlay.tsx#L99>`__
   · → :doc:`05-component-architecture`

#. **The native prompt and its web fallback.** ``useBiometricAuth`` dynamically
   imports the biometric plugin inside try/catch, so on web or desktop the import
   throws and the flow degrades to PIN. Cancelling routes to the PIN pad, not the OS
   passcode.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/hooks/useBiometricAuth.ts#L19>`__
   · → :doc:`12-shared-services-and-components`

#. **PIN entry.** ``PinPad`` (in unlock mode) verifies the entry; a miss records a
   failed attempt and, after five, surfaces a 30-second cooldown. The same component
   serves first-time set and PIN change.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/kiosk/PinPad.tsx#L26>`__
   · → :doc:`05-component-architecture`

#. **Mount and restore.** ``AppLayout`` mounts the overlay and, on unlock, restores
   the pre-lock keep-awake state, closing the lock lifecycle.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/layout/AppLayout.tsx#L111>`__
   · → :doc:`11-application-lifecycle`

Flow 14: Capturing a snapshot
-----------------------------

Saving a still of a live monitor. The source is whatever the tile is currently
showing: a WebRTC ``<video>`` is drawn to a canvas, while an MJPEG ``<img>`` is
either reused as-is or re-fetched as a single still. The save then splits by
platform, base64 on mobile and an anchor download on web.

.. mermaid::

   sequenceDiagram
       autonumber
       participant Btn as Snapshot button
       participant Cap as downloadSnapshotFromElement
       participant ZM as ZoneMinder
       participant Save as Platform save

       Btn->>Cap: pass the live media element
       alt video element
           Cap->>Cap: draw current frame to canvas, toDataURL
       else img element
           Cap->>ZM: re-fetch as mode=single still (if not a data URL)
       end
       Cap->>Save: base64 on mobile / anchor on web
       Save-->>Btn: toast: saved

#. **The button.** ``handleDownloadSnapshot`` on a monitor card reads the live media
   ref and shows a success or failure toast; ``MonitorDetail`` has the same button.
   Snapshots show a toast and are not tracked as background tasks.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/MonitorCard.tsx#L83>`__
   · → :doc:`05-component-architecture`

#. **What the ref points at.** ``LiveMonitorPlayer`` syncs the external media ref to
   the ``<img>`` for MJPEG or the ``<video>`` for WebRTC, which is what makes the
   downstream branch real.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/LiveMonitorPlayer.tsx#L440>`__
   · → :doc:`05-component-architecture`

#. **Capture dispatch.** ``downloadSnapshotFromElement`` builds a timestamped
   filename, then for a ``<video>`` draws the current frame to a canvas and reads a
   JPEG data URL; for an ``<img>`` it reuses a data URL or sends the stream URL on to
   be re-fetched.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts#L286>`__
   · → :doc:`12-shared-services-and-components`

#. **Rewriting a stream to one frame.** ``convertToSnapshotUrl`` unwraps any image
   proxy, then sets ``mode=single`` and strips the streaming params so ZoneMinder
   returns a single still instead of a live multipart stream. The reference
   treatment of this trap, and of what happens when the stream URL is handed to a
   downloader unrewritten, lives in :doc:`12-shared-services-and-components`.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts#L51>`__
   · → :doc:`12-shared-services-and-components`

#. **Data-URL dispatch.** ``downloadSnapshot`` builds the ``.jpg`` filename and picks
   the platform-specific data-URL handler, or falls back to fetching a converted
   still.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts#L268>`__
   · → :doc:`12-shared-services-and-components`

#. **Mobile save (no Blob).** ``downloadDataUrlNative`` splits the base64 off the data
   URL and writes it straight to Documents via Capacitor Filesystem, then adds it to
   the photo library. It never builds a Blob, per the OOM rule.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts#L324>`__
   · → :doc:`12-shared-services-and-components`

#. **Web save.** ``downloadFromDataUrlWeb`` creates a temporary ``<a download>`` with
   the data URL as its href, clicks it, and removes it, triggering the browser's
   native download.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts#L353>`__
   · → :doc:`12-shared-services-and-components`

#. **The MJPEG-still fetch path.** When an ``<img>`` carries a stream URL rather than a
   data URL, the same ``downloadFile`` split from Flow 10 fetches the ``mode=single``
   still: base64 on mobile, Blob on web.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/download.ts#L121>`__
   · → :doc:`07-api-and-data-fetching`

Flow 15: Changing the ZoneMinder run state
------------------------------------------

Every flow above is built around reads. This one is a write. ZoneMinder run
states are named sets of monitor capture functions: the server ships one,
``default``, and users add their own, commonly a Home and an Away. Picking one
on the Server page is how you arm or disarm the system from the app. The counterintuitive part is what happens once the POST succeeds:
the app never touches the cached state list. It invalidates the key and lets the
query fetch the answer back, because the server, not the app, decides what a
state change actually did. Sometimes it cannot decide even in principle, since
the same control also sends ``start``, ``stop`` and ``restart``, which are not
states at all.

.. mermaid::

   sequenceDiagram
       autonumber
       participant User as User
       participant Page as Server page
       participant Mut as changeStateMutation
       participant API as api/states.ts
       participant ZM as ZoneMinder
       participant Cache as Query cache

       Page->>ZM: GET /states.json (the states query)
       ZM-->>Page: states, one flagged IsActive
       Page->>Page: effect seeds selectedAction from activeState
       User->>Mut: Apply, mutate(selectedAction)
       Mut->>API: changeState(stateName)
       API->>ZM: POST /states/change/{name}.json
       ZM-->>API: 200, no useful body
       Note over Mut,Cache: on success: invalidate the key, never patch it
       Mut->>Cache: invalidateQueries(queryKeys.states(profileId))
       Cache->>ZM: the mounted states query refetches
       ZM-->>Page: new IsActive, the badge re-renders

#. **Getting to the control.** The sidebar's Server entry routes to ``/server``
   and renders ``pages/Server.tsx``. The run-state control is the last card on
   that page, "ZoneMinder Control"; everything above it is read-only health and
   storage reporting.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/layout/SidebarContent.tsx#L114>`__
   · → :doc:`04-pages-and-views`

#. **The state list arrives first, and quietly.** ``pages/Server.tsx`` runs a
   ``useQuery`` keyed by ``queryKeys.states(currentProfile?.id)``, gated on
   ``!!currentProfile && isAuthenticated``. Note what it does *not* destructure:
   no ``error``, so this query has no error wall, and no ``refetchInterval``, so
   it never polls. A failed fetch leaves the Current State badge reading
   ``common.unknown`` and the dropdown holding only the three literal actions
   from step 4.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx#L89>`__
   · → :doc:`07-api-and-data-fetching`

#. **The active state is derived, then copied into local state.** ``activeState``
   is just ``states?.find((s) => s.IsActive === '1')``, recomputed on every
   render. An effect then seeds ``selectedAction`` from it. An effect runs *after*
   the render that scheduled it, so the dropdown paints empty for one frame and
   fills on the next; the ``&& !selectedAction`` half of the guard is what stops
   that effect from later stomping on a choice the user made by hand.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx#L134>`__
   · → :doc:`02-react-fundamentals`

#. **The dropdown mixes two unlike things.** ``Select`` (``server-state-select``)
   lists three hardcoded ``SelectItem`` values, ``start``, ``stop`` and
   ``restart``, and then maps one item per fetched state, badging whichever is
   active. Both kinds collapse to the same ``selectedAction`` string, and both
   travel the identical write path below. ZoneMinder's endpoint accepts the daemon
   verbs in the slot where a state name goes.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx#L536>`__
   · → :doc:`05-component-architecture`

#. **Apply is the only trigger.** The ``server-apply-button`` calls
   ``handleApply``, which fires ``changeStateMutation.mutate(selectedAction)``.
   The button disables itself on ``!selectedAction || changeStateMutation.isPending``
   and swaps its icon for a spinner. There is no confirm dialog, and the UI never
   flips optimistically: the badge above it stays on the old state until the
   server has been re-asked.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx#L573>`__
   · → :doc:`05-component-architecture`

#. **What a mutation is.** ``useMutation`` is React Query's wrapper for a write.
   Unlike a query it is never cached, never refetched, and never fires on its own:
   you call ``mutate()`` and it runs ``mutationFn`` once. What it hands back is
   lifecycle, ``isPending`` while the request is open plus ``onSuccess`` and
   ``onError`` callbacks, which is exactly the surface step 5's button binds to.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx#L110>`__
   · → :doc:`07-api-and-data-fetching`

#. **The API call is one line.** ``changeState`` logs the intent and POSTs to
   ``/states/change/{stateName}.json`` with no body. Note what is missing next to
   ``getStates`` directly above it: no ``validateApiResponse``, no Zod schema. The
   response carries nothing worth parsing, so the only signal is the HTTP status.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/states.ts#L44>`__
   · → :doc:`07-api-and-data-fetching`

#. **The write rides the same client as every read.** ``client.post`` is a thin
   alias for the shared ``request()`` in ``api/client.ts``, so this POST inherits
   the auth gate, the just-in-time token refresh, and the single 401 recovery
   retry that Flow 6 traces. A token that lapsed while the Server page sat open
   therefore refreshes and re-sends the POST rather than failing the state change.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/client.ts#L289>`__
   · → :doc:`07-api-and-data-fetching`

Flow 16: Editing and deleting a server profile
-----------------------------------------------

Flow 4 added a profile. Editing and deleting one look like they should be the
same code with a different verb, and they are not. Adding routes to a whole
screen; editing and deleting are two dialogs on the profile list. Two things
here run against what Flow 4 taught. Opening the edit dialog decrypts the saved
password and puts the plaintext into a form field, the exact inverse of "the
password goes to secure storage, never to Zustand". And neither ``updateProfile``
nor ``deleteProfile`` logs out, clears the query cache, or quits a running
stream, all of which ``switchProfile`` does. The clean state comes from a
``window.location.reload()`` in the page, not from the store.

.. mermaid::

   sequenceDiagram
       autonumber
       participant User as User
       participant Page as Profiles page
       participant Store as Profile store
       participant Sec as Secure storage
       participant Client as API client

       User->>Page: tap Edit
       Page->>Store: getDecryptedPassword(id)
       Store->>Sec: getSecureValue("password_<id>")
       Sec-->>Page: plaintext, straight into a form field
       User->>Page: Save
       Page->>Store: updateProfile(id, updates)
       Store->>Sec: savePassword, state keeps the "stored-securely" sentinel
       Store->>Client: rebuild, but only if this is the current profile
       Note over Page,Client: No logout, no cache clear, no stream teardown here.
       Page->>Page: window.location.reload() if the edited profile was current
       User->>Page: tap Delete
       Page->>Store: deleteProfile(id)
       Store->>Sec: removeSecureValue, then auto-select profiles[0]
       Page->>Page: reload, or navigate to /profiles/new if none are left

#. **Both verbs live on the list page.** ``pages/Profiles.tsx`` renders the saved
   profiles and owns an edit dialog and a delete confirmation dialog. Adding is
   the odd one out: the Add button navigates to ``/profiles/new`` and hands off to
   ``ProfileForm``, which is why Flow 4 traces a different file. Discovery, the
   trust-on-first-use dialog and the confirming login all belong to that other
   screen, so an edit never re-probes the server the way an add does.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx#L331>`__
   · → :doc:`04-pages-and-views`

#. **Opening the edit dialog decrypts the password.** ``handleOpenEditDialog``
   sees the persisted ``profile.password`` holding the sentinel string
   ``'stored-securely'``, reaches for ``getDecryptedPassword`` and awaits the real
   secret, then drops the plaintext into ``formData.password``. For as long as the
   dialog is open, the password lives in ordinary React component state. It has to:
   the field has to show a value the user can edit, and the store cannot supply one.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx#L79>`__
   · → :doc:`04-pages-and-views`

#. **The store is read, not subscribed to.** That handler calls
   ``useProfileStore.getState().getDecryptedPassword`` rather than pulling the
   function out of the hook at the top of the component. ``getState()`` reads
   Zustand once with no subscription, so the dialog does not re-render every time
   any other field of the profile store changes. Using the hook here would buy a
   reactive binding for a function that never changes.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts#L423>`__
   · → :doc:`03-state-management-zustand`

#. **Where the secret actually was.** ``getDecryptedPassword`` delegates to
   ``ProfileService.getPassword``, which reads ``getSecureValue('password_<id>')``.
   On iOS and Android that resolves to the Keychain or Keystore. On web and
   Electron it is AES-GCM ciphertext in local storage, with the key material
   sitting in local storage beside it, which ``lib/security/crypto.ts`` states
   plainly is obfuscation and not confidentiality against anyone who can read the
   store.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/services/profile.ts#L23>`__
   · → :doc:`12-shared-services-and-components`

#. **The self-signed toggle is not part of the profile.** The dialog seeds it
   from ``useSettingsStore.getState().getProfileSettings(profile.id)``, because SSL
   trust is a profile-scoped setting, not a field on the ``Profile`` object. Saving
   writes it back through ``updateProfileSettings``. Anything you add to this
   dialog has to pick one of these two homes on purpose.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx#L111>`__
   · → :doc:`03-state-management-zustand`

#. **Saving applies trust before it probes.** ``handleUpdateProfile`` validates
   that username and password are both present or both absent, awaits
   ``applySSLTrustSetting(formData.allowSelfSignedCerts)``, and only then runs
   ``discoverUrls`` for any API or CGI URL the user blanked out. If trust were
   applied after discovery, a self-signed host would fail the handshake and the
   probe would report the server as unreachable. This is the same ordering
   constraint as step 3 of Flow 4.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx#L135>`__
   · → :doc:`13-network-endpoints`

#. **The store swaps the secret back out.** ``updateProfile`` writes any supplied
   password to secure storage with ``ProfileService.savePassword``, then replaces
   it with the ``'stored-securely'`` sentinel before the ``set()`` call. Zustand
   persists the whole profile state to local storage with no ``partialize``, so
   the sentinel is the only thing keeping the plaintext out of the persisted blob.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts#L157>`__
   · → :doc:`03-state-management-zustand`

#. **The client is rebuilt narrowly, and nothing else is torn down.** Still in
   ``updateProfile``, the client is re-created only when both conditions hold: the
   edited profile is the current one, and ``updates.apiUrl`` is present. No
   ``logout()``, no ``clearQueryCache()``, no ``quitAllActiveStreams()``, none of
   the six-step sequence ``switchProfile`` runs. Change a username here and the
   auth store still holds a token minted with the old one.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts#L180>`__
   · → :doc:`11-application-lifecycle`

#. **The reload is what re-authenticates.** Back in the page,
   ``handleUpdateProfile`` closes the dialog and, if the edited profile was the
   current one, calls ``window.location.reload()`` behind a 500ms timeout so the
   success toast is visible first. The reload restarts the app, which re-runs
   ``onRehydrateStorage`` and the whole of Flow 1, and that bootstrap is where the
   new credentials produce a new token. Editing a profile that is not current
   skips the reload entirely and touches nothing but the stored record.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx#L191>`__
   · → :doc:`11-application-lifecycle`

#. **Deleting captures the answer before it destroys the question.**
   ``handleDeleteProfile`` records ``isDeletingCurrent`` before awaiting
   ``deleteProfile``, because afterwards ``currentProfileId`` already points at a
   different profile. It then re-reads ``useProfileStore.getState().profiles``
   rather than trusting the ``profiles`` value captured by its closure: that value
   was frozen when the render that created this handler ran, and it still contains
   the profile just deleted.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx#L208>`__
   · → :doc:`02-react-fundamentals`

#. **The store does three things and stops.** ``deleteProfile`` removes the
   password from secure storage, filters the profile out of the array, and, if the
   deleted profile was current, auto-selects ``profiles[0]`` and points the API
   client at its ``apiUrl``. The session belonging to the deleted server is still
   live in the auth store and its monitor list is still in the query cache.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts#L193>`__
   · → :doc:`03-state-management-zustand`

#. **Which is why the page reloads, or leaves.** ``handleDeleteProfile`` ends in
   one of three ways. No profiles remain: navigate to ``/profiles/new``. The
   current profile was deleted and others remain: ``window.location.reload()``,
   which is the only thing that discards the dead session and cache for the
   auto-selected replacement. Some other profile was deleted: nothing happens
   beyond the list re-rendering, and nothing needs to.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Profiles.tsx#L234>`__
   · → :doc:`04-pages-and-views`

#. **Delete-all is the exception that calls the reset.**
   ``deleteAllProfiles`` loops ``deletePassword`` over every profile, empties the
   state, and is the only one of the three writes to call ``resetApiClient()``,
   which nulls the client and runs the registered reset hooks so the auth
   single-flight gates are cleared. Its caller navigates to ``/profiles/new``
   without a reload, since there is no server left to talk to.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/stores/profile.ts#L223>`__
   · → :doc:`07-api-and-data-fetching`

Switching between two profiles that both exist is the third verb, and the only
one that does the teardown properly. Flow 1 ends by pointing at it.

Flow 17: Aiming a PTZ camera
----------------------------

Tapping a monitor opens ``/monitors/:id``, a live stream with a pan-tilt-zoom pad
under it. Two things make this more than a button wired to an endpoint. The
capabilities of the camera are not on the monitor record, they come from a second
query against a different endpoint that is gated on the first one's answer. And
the pad has two implementations of press-and-hold, chosen by what the camera's
ZoneMinder driver can do: continuous drivers get one start command and one stop
command, while relative and absolute drivers get the same step command re-fired
on a 400ms timer for as long as the button is held. The command that stops the
camera is the one that matters. Nothing else stops it, including the component
being destroyed.

.. mermaid::

   sequenceDiagram
       autonumber
       participant User as User
       participant Page as MonitorDetail
       participant Pad as PTZControls
       participant URL as url-builder
       participant ZM as ZoneMinder

       Page->>ZM: GET /monitors/{id}.json
       ZM-->>Page: Monitor record, Controllable and ControlId
       Page->>ZM: GET /controls/{controlId}.json (only if both are set)
       ZM-->>Pad: driver capabilities: CanMoveCon, HasPresets, NumPresets
       User->>Pad: pointerdown on an arrow
       Note over Pad,ZM: The camera is moving now. Only moveStop ends it.
       Pad->>URL: onCommand("moveConUp")
       URL->>ZM: GET /index.php?request=control&control=moveConUp&xge=0&yge=0
       User->>Pad: pointerup, or the component unmounts
       Pad->>ZM: moveStop

#. **The route is lazy and guarded.** ``App.tsx`` declares ``/monitors/:id``
   pointing at a ``lazy()`` import of ``pages/MonitorDetail``, wrapped in a
   ``RouteErrorBoundary``. The id arrives through ``useParams``, which means the
   page has a monitor id and nothing else: every fact about the monitor has to be
   fetched.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/App.tsx#L239>`__
   · → :doc:`04-pages-and-views`

#. **The monitor record comes first, and it decides everything after it.** A
   ``useQuery`` on ``queryKeys.monitor(profileId, id)`` fetches
   ``/monitors/{id}.json`` through ``getMonitor``, validated against
   ``MonitorDataSchema``. The two fields that drive this flow are ``Controllable``,
   a string ``'1'`` or ``'0'``, and ``ControlId``, a pointer into a table the
   monitor record does not contain.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/MonitorDetail.tsx#L82>`__
   · → :doc:`07-api-and-data-fetching`

#. **Capabilities are a second query, gated on the first.** ``getControl`` hits
   ``/controls/{controlId}.json``, a different table with its own record. Its
   ``enabled`` gate is ``!!monitor?.Monitor.ControlId && monitor.Monitor.Controllable === '1'``.
   A React Query with ``enabled: false`` does not run and stays in a pending state,
   which is exactly what is wanted on the first render: ``ControlId`` is
   ``undefined`` until the monitor lands, and firing ``/controls/undefined.json``
   would be a guaranteed 404 for every non-PTZ camera in the system.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/MonitorDetail.tsx#L89>`__
   · → :doc:`07-api-and-data-fetching`

#. **What the control record says.** ``ZMControlSchema`` coerces every field to a
   string, so a capability is the character ``'1'``, never a boolean. The ones the
   pad reads are ``CanMoveCon``, ``CanMoveRel``, ``CanMoveAbs``, ``CanMoveDiag``,
   ``CanZoomCon`` and ``CanZoomRel``, ``CanReset``, and ``HasPresets`` with
   ``NumPresets``. There is no field that says "this camera can pan", only fields
   that say how.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/monitors.ts#L82>`__
   · → :doc:`07-api-and-data-fetching`

#. **The stream ignores your snapshot setting.** ``LiveMonitorPlayer`` renders
   with ``forceViewMode="streaming"``, so the global Snapshot bandwidth mode that
   throttles the montage does not apply on this page: you opened one camera and you
   get a live feed. Its ``key={monitor.Monitor.Id}`` forces a full remount when the
   id changes, rather than letting a stream from the previous monitor limp along
   inside a reused component.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/MonitorDetail.tsx#L364>`__
   · → :doc:`05-component-architecture`

#. **The pad mounts on the monitor's word, then waits for the control record.**
   ``PTZControls`` renders when ``!isFullscreen && monitor.Monitor.Controllable === '1'``,
   and receives ``control={controlData?.control.Control}``, which is ``undefined``
   while the query from step 3 is still in flight. The component returns ``null``
   for that undefined case, so the panel appears one render after the monitor does.
   Fullscreen is CSS, not the browser Fullscreen API, and it hides the pad because
   there is nowhere to put it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/MonitorDetail.tsx#L480>`__
   · → :doc:`05-component-architecture`

#. **The driver picks the verb.** ``PTZControls`` computes
   ``movePrefix = canMoveCon ? 'moveCon' : (canMoveRel ? 'moveRel' : 'moveCon')``
   and appends a direction, producing ``moveConUp`` or ``moveRelUp``. Diagonal
   buttons are rendered but ``invisible`` without ``CanMoveDiag``, which keeps the
   3x3 grid from collapsing. Zoom does the same with ``zoomCon`` and ``zoomRel``.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/PTZControls.tsx#L149>`__
   · → :doc:`05-component-architecture`

#. **Press and hold has two implementations.** ``moveRepeatMs`` is ``undefined``
   for a continuous driver and ``UI_INTERACTIONS.ptzHoldRepeatMs`` (400ms) for
   anything else. ``HoldButton`` fires the command once on ``pointerdown``, and if
   it was given a repeat interval it starts a ``setInterval`` re-firing that same
   command. ZoneMinder's protocol has no continuous verb on relative and absolute
   drivers, so a stream of discrete steps is the only way to get hold-to-move on
   them. On release, both paths send ``moveStop``: the continuous camera needs it,
   the stepping camera ignores it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/PTZControls.tsx#L155>`__
   · → :doc:`05-component-architecture`

#. **Unmounting while held is the interesting failure.** ``pointerup`` never
   arrives if the panel collapses, the monitor changes, or the user leaves the
   page. A continuous camera would keep panning into its physical limit and the
   repeat timer would keep issuing requests from a dead component. ``HoldButton``
   therefore has an unmount cleanup effect that clears the timer and sends the stop
   command. It reads the handlers from a ``cleanupParamsRef`` refreshed on every
   render, because a cleanup function closes over the values from the render that
   created it, and a guard on ``activePointerRef`` makes the whole thing a no-op on
   the throwaway mount React StrictMode performs in development.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/components/monitors/PTZControls.tsx#L98>`__
   · → :doc:`02-react-fundamentals`

#. **One handler, one API call, no state.** Every button calls the ``onCommand``
   prop, which is ``handlePTZCommand`` from the ``usePTZControl`` hook. It calls
   ``controlMonitor`` and, on failure, shows a toast. There is no mutation, no
   optimistic update, no query invalidation and no read-back: the app never asks
   the camera where it ended up pointing, because the live stream already shows it.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/hooks/usePTZControl.ts#L33>`__
   · → :doc:`07-api-and-data-fetching`

#. **The control endpoint is the classic web UI, not the API.**
   ``controlMonitor`` builds a URL against ``/index.php`` rather than
   ``/api/...``, runs it through ``wrapWithImageProxy``, and sends it with a
   ``Skip-Auth`` header. Skipping the auth gate is correct here precisely because
   the access token is already baked into the query string by the URL builder, the
   same way the streaming URLs in Flow 2 carry theirs.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/api/monitors.ts#L328>`__
   · → :doc:`13-network-endpoints`

#. **Two server quirks live in the URL builder.** ``getMonitorControlUrl`` matches
   ``presetGoto<N>`` and splits it into ``control=presetGoto`` plus ``preset=<N>``,
   the structured form ZoneMinder's Perl drivers read, so the client does not depend
   on a translation regex in the server's PHP surviving a refactor. It then attaches
   ``xge=0&yge=0`` only to commands matching an axis, mode and direction, such as
   ``moveConUp``. The server uses the presence of those two parameters to decide it
   is parsing a movement command; send them with ``moveStop`` or ``presetHome`` and
   it logs "Invalid control parameter" and does nothing.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/zm/url-builder.ts#L174>`__
   · → :doc:`13-network-endpoints`

This page is the only place in the app that sends a control command. The PTZ badge
on ``MonitorCard`` reads the same ``Controllable`` field but only to tell you the
camera has a pad waiting for you here. The stream underneath the pad is Flow 2.

#. **A failed write is never retried.** ``App.tsx`` passes ``retry:
   shouldRetryQuery`` under ``defaultOptions.queries`` and gives ``mutations`` no
   entry at all, so mutations fall back to React Query's default of zero retries.
   That asymmetry is deliberate. Re-issuing a GET is free; silently re-issuing
   ``restart`` means the app bounces a server the user already watched fail to
   bounce.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/App.tsx#L63>`__
   · → :doc:`07-api-and-data-fetching`

#. **Success invalidates the key rather than editing the cache.** ``onSuccess``
   toasts, then calls
   ``queryClient.invalidateQueries({ queryKey: queryKeys.states(currentProfile?.id) })``.
   Writing ``IsActive: '1'`` into the cached array by hand would be faster and
   would be a lie. ZoneMinder may normalize the name or refuse the change, and
   when the user picked ``start`` there is no matching entry in that array to
   patch at all: the daemon verbs are not states. Refetching is the only answer
   the app can actually justify.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx#L117>`__
   · → :doc:`07-api-and-data-fetching`

#. **The invalidated key comes from the factory.** ``queryKeys.states`` returns
   ``['states', profileId]``, the same array the query in step 2 was keyed with.
   Invalidation matches by key prefix, so this reaches that entry and any future
   longer key under it. Rule 29 forbids writing the array inline precisely here:
   an invalidator that spells its own key drifts away from the query that reads
   it, and the symptom is a page that silently stops updating. The ``profileId``
   is a branded ``ProfileId``, minted once by ``asProfileId`` when ``addProfile``
   generates the UUID back in Flow 4, and it is what keeps one profile's states
   out of another's cache.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/lib/query/query-keys.ts#L138>`__
   · → :doc:`07-api-and-data-fetching`

#. **The refetch is the only thing that can update the badge.** Invalidating marks
   the entry stale and immediately refetches it if a mounted component is still
   observing it, and the states query from step 2 is. That query has no
   ``refetchInterval``, so without this invalidation the Current State badge would
   keep showing the old state until the page remounted. The 15-second
   ``staleTime`` from Flow 2 does not hold the refetch back either: freshness
   governs whether a refetch is *needed*, invalidation declares that it is.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx#L89>`__
   · → :doc:`02-react-fundamentals`

#. **The user hears about it through a toast.** ``onSuccess`` and ``onError`` raise
   ``toast({ title, description })`` from ``hooks/use-toast``, the error variant
   being ``destructive``, and each writes a ``log.server`` line. There is no
   navigation and no modal; the page you changed the state from is the page you
   stay on.
   `source <https://github.com/ZoneMinder/zmNinjaNg/blob/main/app/src/pages/Server.tsx#L112>`__
   · → :doc:`05-component-architecture`

``pages/States.tsx`` wraps the same ``changeState`` in its own mutation, but
nothing routes to it and nothing imports it, so no user ever walks that code
(issue #231). The Server page holds the app's only ``useMutation`` and its only
write to the ZoneMinder run state; other writes (PTZ, event delete, push
registration) go through plain handlers, not mutations. Steps 8
and 9 lean on the client behavior traced in Flow 6: if the access token lapsed
while the page sat open, the 401 recovery there runs and re-sends this POST before
the mutation ever reports a failure.

These flows touch most of the moving parts of the app. When you need to change
something, find the nearest scene, open its ``source`` link to land on the exact
code, and follow the ``→`` link for the chapter that explains that layer.
