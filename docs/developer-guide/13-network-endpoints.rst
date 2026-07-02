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

``scripts/generate-release-notice.mjs`` drafts a notice and prepends it to
``docs/notices.json``. A root-level shortcut runs it with no arguments:

.. code-block:: bash

   npm run notice          # reads version from app/package.json

Pass the version (and optionally the tag) as positional arguments:

.. code-block:: bash

   node scripts/generate-release-notice.mjs 1.8.0
   node scripts/generate-release-notice.mjs 1.8.0 zmNinjaNg-1.8.0

With no arguments, the script reads ``version`` from ``app/package.json`` and
derives the tag as ``zmNinjaNg-<version>``.

The script calls ``claude -p`` with a prompt that includes the relevant
``CHANGELOG.md`` section and asks for ``{"title": "...", "body": "..."}``.
If ``claude`` is not on PATH, or if its output cannot be parsed as JSON, the
script falls back to a link-only draft and continues. It never blocks the
release.

After printing the proposed notice, the script asks:

.. code-block:: text

   Add and push this notice? [y/N/e(dit)]

- ``y``: writes ``docs/notices.json``, commits with
  ``chore: add release notice for <version> (refs #211)``, and pushes.
- ``e``: opens the draft in ``$EDITOR``; the edited version is written after
  the editor closes.
- ``N`` (or anything else): exits without writing.

If the git step fails, the notice is already written locally and can be
committed manually. The script always exits with code 0 so the release is
not blocked.

Flags
^^^^^

.. list-table::
   :header-rows: 1
   :widths: 22 78

   * - Flag
     - Effect
   * - ``--replace``
     - Upsert: overwrite an existing ``release-<version>`` entry and move it
       to the front of the feed. Without this flag, if the notice already
       exists the script prints ``A notice for <version> already exists. Pass
       --replace to overwrite.`` and exits.
   * - ``--stub-claude``
     - Skip the ``claude -p`` call and use a static stub draft. Useful for
       testing the write path without a Claude API call.
   * - ``--dry-run``
     - Write ``docs/notices.json`` but do not commit or push.

Integration with make_release.sh
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

On minor and major releases (patch = 0), ``scripts/make_release.sh`` offers
to generate a notice after the changelog step. It checks ``docs/notices.json``:

- If a notice for the version already exists, it prints ``A developer notice
  for <version> already exists.`` and asks ``Regenerate it? [y/N]``. Answering
  ``y`` re-runs the generator with ``--replace``.
- Otherwise it asks ``Generate a developer notice for this release? [y/N]``.
  Answering ``y`` runs the generator without ``--replace``.

Either step can be skipped; the release continues either way.
