External Network Endpoints
==========================

zmNinjaNg talks to your own ZoneMinder server using the URLs configured in each
profile (portal, API, CGI/ZMS, go2rtc). Beyond those, the app reaches out to a
small, fixed set of external endpoints. This chapter lists every external
endpoint, why it is contacted, on which platforms, how often, what triggers it,
and how to turn it off.

Profile and ZoneMinder server URLs are intentionally excluded here, since those
are servers you configure and control.

Endpoints
---------

.. list-table::
   :header-rows: 1
   :widths: 22 20 14 12 16 16

   * - Endpoint
     - Why
     - Platforms
     - How often
     - Trigger
     - How to disable
   * - ``raw.githubusercontent.com/ZoneMinder/zmNinjaNg/main/docs/notices.json``
     - Maintainer notices shown in-app. Read-only fetch; nothing is sent.
     - Web, Desktop (Electron), iOS, Android
     - Every 24 hours
     - App launch, the 24-hour poll, and window focus when the cached copy is
       older than 24 hours.
     - No in-app toggle. Can only be blocked at the network level.
   * - Google FCM (``fcm.googleapis.com``, ``firebaseinstallations.googleapis.com``)
     - Acquire and refresh the push token so the ZoneMinder server can send push
       notifications.
     - iOS, Android only
     - Not polled
     - App init, Firebase token refresh, and profile change.
     - Turn off notifications in the profile's Notification settings
       (``enabled = false``). Never runs on Web or Desktop.
   * - Google FCM push channel (OS-maintained)
     - Inbound push message delivery.
     - iOS, Android only
     - Event-driven
     - An incoming push message.
     - Same as above, plus the OS-level notification permission.
   * - ``stun:stun.cloudflare.com:3478``, ``stun:stun.l.google.com:19302``
     - WebRTC ICE / NAT traversal when viewing a go2rtc live stream over WebRTC.
     - Web, Desktop, iOS, Android (only when WebRTC is the active method)
     - Not polled
     - Starting a go2rtc WebRTC live stream.
     - Set the streaming method to MJPEG, or remove WebRTC from the WebRTC
       protocols list (leaving MSE/HLS), or view a monitor that has no go2rtc
       source. MSE, HLS, and MJPEG never contact STUN.
   * - ``zmninjang.readthedocs.io``
     - This documentation.
     - All
     - On demand
     - Tapping "Help Docs", which opens the system browser.
     - Do not tap it.

Notes
-----

- Only the notices feed runs on a fixed timer (24 hours, set by
  ``DEVELOPER_NOTICES.pollIntervalMs`` in ``lib/zmninja-ng-constants.ts``). FCM
  and STUN are demand- or event-driven.
- The push token is registered with your own ZoneMinder server, not with any
  third party.
- There are no analytics or telemetry endpoints. The Firebase Analytics SDK is
  not bundled on any platform, and collection is explicitly disabled via the
  ``firebase_analytics_collection_enabled`` (Android) and
  ``FIREBASE_ANALYTICS_COLLECTION_ENABLED`` (iOS) flags.
- STUN is reached only through the WebRTC path. ``lib/vendor/go2rtc/video-rtc.js``
  creates the ``RTCPeerConnection`` (and uses the STUN ``iceServers``) only when
  the active protocol list includes ``webrtc``.
