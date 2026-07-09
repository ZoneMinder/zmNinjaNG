Key Libraries
=============

This chapter documents the third-party libraries used in zmNinjaNg and
how they are used.

UI and Visualization
--------------------

react-grid-layout
~~~~~~~~~~~~~~~~~

Used for the **Dashboard** drag-and-drop interface.

- **Usage**: Enables movable, resizable widgets.
  ``components/dashboard/DashboardLayout.tsx`` imports ``GridLayout`` and wraps
  it once at module scope: ``const WrappedGridLayout = WidthProvider(GridLayout)``.
  ``WidthProvider`` measures the container and feeds its width down, which the
  grid needs because it positions items in pixels, not CSS columns.
- **Key Concepts**: ``Layout`` objects (``x``, ``y``, ``w``, ``h``, and an ``i``
  key naming the item). Dashboard widgets persist their own ``WidgetLayout``
  shape per profile in ``stores/dashboard.ts``, so a dragged widget stays where
  the user put it across restarts.
- **Gotchas**: Requires careful handling of drag events to prevent
  conflicts with interactive widget content (see ``DashboardWidget.tsx``).
- **Why**: It is the most mature and stable React library for grid-based
  dashboards with drag-and-drop resizing support.

The montage screen borrows react-grid-layout's ``Layout`` type
(``components/montage/hooks/useMontageGrid.ts``, and ``MontageSavedLayout`` in
``stores/settings.ts``) without ever rendering a ``GridLayout``. Montage tiles
are positioned by the montage code itself.

video.js
~~~~~~~~

Used for MP4 event playback in ``components/events/Mp4EventPlayer.tsx``, the
only file that imports the video.js runtime. (``contexts/PipContext.tsx``
imports its types only, with ``import type videojs from 'video.js'``.)

- **Usage**: Video playback for recorded event MP4s.
- **Plugins**: ``videojs-markers`` draws event points on the seek bar. The
  marker configs are built in ``lib/event/video-markers.ts`` and applied to the
  player there.
- **Why**: ZoneMinder streams vary in format (MJPEG, multiple MP4
  profiles). The native ``<video>`` element handles these inconsistently
  across browsers; video.js provides a unified API and plugin surface.

Neither live monitor streams nor ZMS event playback go through video.js. ZMS
delivers a multipart JPEG stream, not a container format a video element can
consume, so ``components/events/ZmsEventPlayer.tsx`` binds it to an ``<img>``
element instead. ``components/monitors/LiveMonitorPlayer.tsx`` does the same for
the MJPEG path, and falls back to it when the WebRTC path (go2rtc, via
``lib/vendor/go2rtc/video-rtc.js``) is unavailable or fails. See
:doc:`go2rtc-integration`.

lucide-react
~~~~~~~~~~~~

The standard icon set for the application.

- **Usage**: ``<IconName className="h-4 w-4" />``
- **Style**: Consistent, clean SVG icons that scale well.

@radix-ui/\*
~~~~~~~~~~~~

Headless UI primitives for accessible components.

- **Usage**: Popovers, Dialogs, dropdowns, switches, etc.
- **Styling**: Styled with Tailwind CSS via ``shadcn/ui`` pattern.
- **Why**: Unstyled primitives leave visual design entirely to Tailwind
  while keeping keyboard navigation and screen-reader support correct.

recharts
~~~~~~~~

Charting for dashboard widgets. ``components/dashboard/widgets/TimelineWidget.tsx``
uses ``BarChart``, ``Bar``, ``XAxis``, ``YAxis``, ``Tooltip``, and
``ResponsiveContainer`` to plot event counts over time.

Data and Logic
--------------

date-fns
~~~~~~~~

Date arithmetic and formatting. The functions actually imported across
``app/src`` are ``format``, ``parseISO``, ``formatDistanceToNow``, ``isToday``,
``isYesterday``, and arithmetic helpers such as ``addHours``, ``addDays``,
``subDays``, ``startOfHour``, ``startOfDay``, ``startOfWeek``, ``startOfMonth``,
and ``differenceInDays``.

- **Standard**: never call date-fns ``format()`` with a literal pattern for
  anything a user sees. User-visible dates and times go through
  ``useDateTimeFormat()`` inside React components, or ``formatAppDate`` /
  ``formatAppTime`` / ``formatAppDateTime`` from ``lib/format-date-time.ts``
  outside React. Those wrappers are the only place that calls date-fns
  ``format()``, and they read the user's chosen date and time format from
  profile settings before doing so. This is rule 23 in ``AGENTS.md``, and it
  covers canvas rendering, tooltips, and scrubber overlays as much as it covers
  JSX.
- **Why**: Lightweight and immutable compared to Moment.js.

Two things that look like date-fns but are not. Relative labels such as "5m ago"
come from ``Intl.RelativeTimeFormat`` in ``lib/relative-time.ts``, because it
localizes into all five bundled languages without shipping locale files.
Timezone conversion for ZoneMinder's server-local timestamps uses
``Intl.DateTimeFormat`` with an explicit ``timeZone`` in ``lib/time.ts``.
``date-fns-tz`` is declared in ``app/package.json`` but is not imported anywhere
in ``app/src``.

react-hook-form & zod
~~~~~~~~~~~~~~~~~~~~~

Form handling and validation.

- **Usage**: Profile creation, settings forms.
- **Pattern**: Zod schemas define the data shape and validation rules;
  react-hook-form handles the state.
- **Why**: Zod schemas double as TypeScript types, giving the same shape
  for form input and API payloads.

Zod also guards the network boundary. A TypeScript ``interface`` is erased
before the code runs, so nothing stops a ZoneMinder server from returning a
login response missing ``access_token``. ``api/auth.ts`` therefore runs
``LoginResponseSchema.parse(response.data)`` and fails loudly at the seam
instead of far downstream.

@tanstack/react-query
~~~~~~~~~~~~~~~~~~~~~

React Query holds every piece of data that came from a ZoneMinder server: the
monitor list, event pages, server status, daemon health. The problem it solves
is that this data is a cache of somebody else's state, not this app's state. It
can go stale while the user is looking at it, two screens can want it at once,
and a request can fail halfway. Putting it in a Zustand store would mean
hand-writing loading flags, error flags, deduplication, and refetch timers for
each screen.

Instead, each piece of server data is identified by a **query key**, and React
Query owns the cache entry behind that key: who is fetching it, when it last
succeeded, whether it needs refetching. Two components asking for the same key
share one network request and one cache entry. Every key in this codebase comes
from the ``queryKeys`` factory in ``lib/query/query-keys.ts`` rather than an
inline array, so that a mutation invalidating a key cannot drift out of sync
with the queries reading it (rule 29 in ``AGENTS.md``).

- **Usage**: Caching API responses, handling loading and error states, and
  backing the Events page's endless list. That list is not ``useInfiniteQuery``:
  ``hooks/useEventPagination.ts`` keeps a growing result count in ``useState``
  (mirrored into a store so it survives remounts) and ``pages/Events.tsx``
  re-runs a plain ``useQuery`` with ``placeholderData: keepPreviousData``, so
  the visible rows do not blank out while the larger page is in flight.
- **Key Config**: ``staleTime`` and ``refetchInterval``. Never hardcode the
  interval: read it from ``useBandwidthSettings()`` so that low-bandwidth mode
  slows every poller at once (rule 8).

React Query's model (queries, keys, the cache, and why a component re-renders
when the cache entry changes) is taught in :doc:`02-react-fundamentals`. How
this app wires it to ZoneMinder, including the query-key factory, invalidation,
error walls, and the polling intervals, is in :doc:`07-api-and-data-fetching`.

Mobile and Platform
-------------------

@capacitor/\*
~~~~~~~~~~~~~

Native device feature access for iOS and Android. The plugins imported by
``app/src`` are:

- **Core** (``@capacitor/core``): platform detection (``isNativePlatform``).
- **App** (``@capacitor/app``): the ``appStateChange`` and ``pause`` lifecycle
  events. Used to flush the log buffer on background and to clear the
  notification badge on resume.
- **Filesystem**: writes the persistent log file (``lib/log-file/capacitor.ts``)
  and exports logs from the Logs page.
- **Network**: detects network status changes on native platforms
  (WiFi/cellular transitions). Used by ``useNotificationAutoConnect`` to
  trigger an immediate WebSocket reconnect when connectivity is restored.
- **Haptics**, **Share**, **SplashScreen**: as their names suggest.

Saved snapshots and videos do not go through Filesystem alone.
``services/download.ts`` writes the file, then hands it to
``@capacitor-community/media`` (``Media.savePhoto`` / ``Media.saveVideo``) so it
lands in the device gallery rather than in app-private storage.

Push notifications do not use ``@capacitor/push-notifications``. They use
``@capacitor-firebase/messaging``, which handles APNS and FCM tokens through
one Firebase API. Badge counts use ``@capawesome/capacitor-badge``.
``@capacitor/preferences`` is declared in ``app/package.json`` but is not
imported anywhere in ``app/src``.

Credentials are encrypted through ``lib/security/secureStorage.ts``, which
delegates to ``@aparajita/capacitor-secure-storage`` on iOS and Android.
Biometric unlock uses ``@aparajita/capacitor-biometric-auth``.

- **Why**: Build iOS/Android apps from the same web codebase. Drop into
  native plugins only for hardware access the web API doesn't provide.

Per rule 14 in ``AGENTS.md``, Capacitor plugins are loaded with dynamic
``import()`` behind a platform check, never a static import, because a static
import of a native-only plugin breaks the web and Electron builds at bundle
time.

Internationalization
--------------------

i18next & react-i18next
~~~~~~~~~~~~~~~~~~~~~~~

Translations and localization.

- **Usage**: ``const { t } = useTranslation();``
- **Files**: ``src/locales/`` contains JSON files for each language.
- **Rule**: No hardcoded strings in UI components. All five languages (en, de,
  es, fr, zh) are updated together (rule 5).

Constants Organization
----------------------

zm-constants.ts
~~~~~~~~~~~~~~~

**ZoneMinder Protocol Constants**. Official protocol values defined by
the ZoneMinder streaming daemon.

.. code:: tsx

   import { ZMS_COMMANDS, ZMS_MODES, ZM_MONITOR_FUNCTIONS } from '../lib/zm/zm-constants';

   // Stream control commands
   ZMS_COMMANDS.cmdQuit   // 17 - Close stream connection
   ZMS_COMMANDS.cmdPause  // 1 - Pause playback
   ZMS_COMMANDS.cmdPlay   // 2 - Start/resume playback

   // Stream modes
   ZMS_MODES.jpeg    // MJPEG streaming
   ZMS_MODES.single  // Single snapshot

**When to use**: Interacting with ZoneMinder's streaming server (ZMS) or
monitor control APIs.

zmninja-ng-constants.ts
~~~~~~~~~~~~~~~~~~~~~~~

**Application Configuration**. zmNinjaNg-specific settings and tuning
parameters.

.. code:: tsx

   import { ZM_INTEGRATION, GRID_LAYOUT, TIMELINE } from '../lib/zmninja-ng-constants';

   // API timeouts and performance settings
   ZM_INTEGRATION.httpTimeout           // 10000 ms
   ZM_INTEGRATION.streamMaxFps          // 10 FPS for live streams
   ZM_INTEGRATION.accessTokenLeewayMs   // 30 minutes; refresh fires below this

   // Grid layout configuration
   GRID_LAYOUT.cols                     // 12 columns
   GRID_LAYOUT.rowHeight                // 100px per row
   GRID_LAYOUT.montageRowHeight         // 1px (per-pixel precision for compact montage)

   // Timeline zoom limits
   TIMELINE.zoomMin  // 60000 ms (1 minute)
   TIMELINE.zoomMax  // 604800000 ms (1 week)

**When to use**: Configuring application behavior, performance tuning,
UI layout.

Rule 25 in ``AGENTS.md`` makes this the only home for named constants. If you
find yourself typing a timeout, threshold, storage key, or animation duration
inline, it belongs in one of these two files instead.

**Separation rationale**:

- **zm-constants**: Never change (defined by ZoneMinder protocol)
- **zmninja-ng-constants**: Can be tuned for performance, UX, or
  platform differences
