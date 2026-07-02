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

Developer Notice Feed
---------------------

``docs/notices.json`` is a JSON array of notice objects. Each object is
validated on load against this schema:

.. list-table::
   :header-rows: 1
   :widths: 22 10 68

   * - Field
     - Required
     - Description
   * - ``id``
     - Yes
     - Unique string. Release notices use ``release-<version>``.
   * - ``title``
     - Yes
     - Short display title; generation target is under 60 characters.
   * - ``body``
     - Yes
     - Notice text. May include one Markdown link.
   * - ``publishedAt``
     - Yes
     - ISO 8601 timestamp set at generation time.
   * - ``severity``
     - Yes
     - ``info``, ``warning``, or ``critical``. Release notices use ``info``.
       ``critical`` also triggers a global dismissible banner.
   * - ``link``
     - No
     - URL shown alongside the notice. For release notices, the GitHub release
       page.
   * - ``minAppVersion``
     - No
     - When set, notices are hidden on app versions older than this value.
       Release notices set it to the released version.

Generating a release notice
~~~~~~~~~~~~~~~~~~~~~~~~~~~

``scripts/generate_notice.mjs`` drafts a notice and upserts it into
``docs/notices.json``. Run it from the repo root:

.. code-block:: bash

   npm run notice            # prompts for version, defaulting to app/package.json
   npm run notice 1.8.0     # pass version directly
   node scripts/generate_notice.mjs 1.8.0

If no version is passed, the script prompts for one and defaults to the version
in ``app/package.json``. The tag is always derived as ``zmNinjaNg-<version>``.

The script:

1. Runs ``bundle exec github_changelog_generator --future-release zmNinjaNg-<version>``
   into a temporary file to collect the closed issues since the last tag (the
   repo's ``.github_changelog_generator`` sets ``pulls=false``, matching
   ``CHANGELOG.md``). ``CHANGELOG.md`` is not modified.
2. Calls ``claude -p`` with the relevant changelog section and asks for
   ``{"title": "...", "body": "..."}``.
3. Prints the proposed notice and asks:

.. code-block:: text

   Add this notice? [y/N/e(dit)]

- ``y``: upserts the notice into ``docs/notices.json`` (overwrites an existing
  entry with the same ``id``, or prepends if new). No git commit or push.
- ``e``: opens the draft in ``$EDITOR``; the edited version is written after
  the editor closes.
- ``N`` (or anything else): exits 0 without writing.

There are no fallbacks. If ``gh``, ``bundle``/``github_changelog_generator``,
or ``claude`` is missing or fails, if the output is not parseable JSON, or if
``docs/notices.json`` is corrupt, the script prints a clear error and exits
non-zero.

To test without keeping the result: run the script, verify in the app, then
``git checkout -- docs/notices.json`` to discard.

Integration with make_release.sh
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

On minor and major releases (patch = 0) that do not already have a notice in
``docs/notices.json``, ``scripts/make_release.sh`` asks:

.. code-block:: text

   Generate a developer notice for <version>? [y/N]

Answering ``y`` runs ``node scripts/generate_notice.mjs <version>`` with no
error guard. Any failure halts the release (``set -e``). After a successful
generation, ``make_release.sh`` commits and pushes ``docs/notices.json`` so
the notice ships with the release.

If the version already has a notice in ``docs/notices.json``, or if the
release is a patch release, the prompt is skipped.
