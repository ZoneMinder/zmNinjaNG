Component Architecture
======================

This chapter follows the app's components through the features they build:
watching a live camera, playing back a recording, deleting a batch of events,
laying out a dashboard, locking the screen. Each section starts from something
the user does and works inward to the code.

Reference material for the shared building blocks (``components/ui/``,
``components/common/``, ``lib/``, ``services/``) lives in
:doc:`12-shared-services-and-components`. Generic React mechanisms are taught
once in :doc:`02-react-fundamentals` and linked from here at the point where
this app first depends on them.

How ``components/`` is organized
--------------------------------

``src/components/`` splits three ways. Feature folders (``monitors/``,
``montage/``, ``events/``, ``dashboard/``, ``kiosk/``, ``timeline/``,
``settings/``, ``notifications/``, ``filters/``, ``layout/``,
``monitor-detail/``, ``assistant/``) hold components that only make sense
inside that feature.
``ui/`` holds unstyled primitives, mostly shadcn/ui wrappers over Radix, that
know nothing about ZoneMinder. ``common/`` holds three app-aware but
feature-agnostic components (``RefreshButton``, ``PageContainer``,
``GridColumnsMenu``).

A handful of components sit at the top level because they are mounted once by
the app shell rather than by a feature: ``NotificationHandler``,
``BackgroundTaskDrawer``, ``CommandPalette``, ``ErrorBoundary``,
``RouteErrorBoundary``, ``QRScanner``, ``CertTrustDialog``, and the theme and
profile switchers.

Hooks do not all live in ``src/hooks/``. Domain-scoped hooks sit next to the
code that uses them: ``pages/hooks/`` (``usePTZControl``, ``useAlarmControl``)
and ``components/montage/hooks/`` (``useMontageGrid``, ``useContainerResize``,
``useFullscreenMode``). ``components/montage/index.ts`` re-exports those three
hooks along with ``GridLayoutControls``, ``FullscreenControls``,
``MontageKebabMenu``, and ``MontageTileErrorBoundary``. It does not export
``getMaxColsForWidth``; that helper lives in ``lib/event/event-utils.ts``.

For the ``app/src/`` tree as a whole, see the File Organization table in
:doc:`index`.

Watching a live camera
----------------------

MonitorCard
~~~~~~~~~~~

**Location**: ``src/components/monitors/MonitorCard.tsx``

Open the Monitors page and each camera appears as a card: a live picture, a
colored status dot, resolution and FPS, and buttons for that monitor's events,
its settings, and a snapshot download. ``MonitorCard`` renders two layouts from
one component. With ``compact`` set it is a grid tile with the picture on top;
without it, a wide row with the picture on the left at 40% width.

``MonitorCard`` does not stream anything itself. It hands the monitor to
``LiveMonitorPlayer`` and lets that component pick a protocol:

.. code:: tsx

   const videoPlayer = (
     <LiveMonitorPlayer
       monitor={monitor}
       profile={currentProfile}
       className="w-full h-full"
       objectFit={resolvedFit}
       externalMediaRef={mediaRef}
       muted={isMuted}
       onProtocolChange={setProtocol}
     />
   );
   const wrappedVideo = showHover ? (
     <MonitorHoverPreview monitor={monitor}>{videoPlayer}</MonitorHoverPreview>
   ) : videoPlayer;

Two things travel back out of the player. ``onProtocolChange`` reports the
protocol that actually connected, which the card shows as a small label in the
corner when ``settings.showProtocolLabel`` is on. ``externalMediaRef`` is a ref
that the player attaches to whichever element it ended up rendering, an
``<img>`` for MJPEG or a ``<video>`` for go2rtc. A *ref* is React's escape hatch
to a real DOM node: a mutable box whose ``.current`` React fills in after it
commits the element to the page (:doc:`02-react-fundamentals`). The card needs
it because downloading a snapshot means reading pixels off the live element:

.. code:: tsx

   const handleDownloadSnapshot = async (e: React.MouseEvent) => {
     e.stopPropagation();
     if (mediaRef.current) {
       try {
         await downloadSnapshotFromElement(mediaRef.current, monitor.Name);
         toast.success(t('monitors.snapshot_downloaded'));
       } catch (error) {
         log.monitorCard('Failed to download snapshot', LogLevel.ERROR, error);
         toast.error(t('monitors.snapshot_failed'));
       }
     }
   };

The ``e.stopPropagation()`` is load-bearing. The picture and its wrapper are a
click target that navigates to ``/monitors/<id>``, and the download button sits
inside it. Without stopping the event, downloading a snapshot would also open
the monitor.

The Events button carries a ``monitor-new-events-badge`` counting events the
monitor recorded since the user last opened it. The count arrives as the
``newEventCount`` prop from ``useMonitorNewEvents`` on the Monitors page, and the
badge renders only when ``newEventCount !== undefined && newEventCount > 0``,
formatted by ``formatEventCount``. The ``undefined`` guard is not the same as a
count of 0: ``undefined`` is "the count query has not resolved yet", 0 is
"nothing new", and only the second should keep the badge off. Tapping the button
runs ``openEvents``, a thin wrapper over the shared ``useOpenMonitorEvents`` hook:
it stamps the watermark with ``markSeen`` from the cached newest timestamp, then
navigates to the events list filtered to the events the badge counted (a
``startDateTime`` one second past the old watermark). ``MontageMonitor`` renders
the same badge (``montage-new-events-badge``) and calls the same hook with
``from: '/montage'``, so both surfaces share one click behavior.
:doc:`call-flows` Flow 18 traces the count from the API to this render.

``useOpenMonitorEvents`` (``hooks/useOpenMonitorEvents.ts``) is the extracted
click handler both surfaces share. It takes ``{ monitorId, newEventCount,
newestEventAt, from }`` and returns nothing: it reads the old watermark before
``markSeen`` overwrites it, so the date filter it writes matches what the badge
counted rather than what "seen" becomes after the click. It drops the date param
entirely for a quiet monitor (``newEventCount`` is 0 or undefined) or a
never-seeded one (the watermark is ``null``, so the whole history is the new set).

The whole component is wrapped in ``memo``:

.. code:: tsx

   export const MonitorCard = memo(MonitorCardComponent);

``memo`` tells React to skip re-rendering a component when its props are equal
to last time's. Skipping matters here because the Monitors page re-renders on
every status poll, and a re-render of ``MonitorCard`` would re-render
``LiveMonitorPlayer``, which would tear the stream down and build it back up.

MontageMonitor
~~~~~~~~~~~~~~

**Location**: ``src/components/monitors/MontageMonitor.tsx``

The montage grid shows many cameras at once, so its tile is stripped down: a
32px-tall header (``h-8``) with the status dot, the name, an events button, a
mute button for go2rtc monitors, and an overflow menu holding snapshot and
timeline. In fullscreen the header slides up out of view and returns on hover.
In edit mode the tile draws a 2px border overlay, yellow normally and blue when
the tile is pinned. That border is a separate absolutely-positioned ``div``
rather than a CSS ring on the card, because the compact grid styles override
ring utilities.

``MontageMonitor`` is also ``memo``-wrapped, and the source says why in the
same terms as above: grid layout changes re-render the parent, and the streams
must not be torn down and re-established because of it.

The tile pulses when its monitor alarms. It reads the notification store, but
only the slice it needs:

.. code:: tsx

   const monitorEvents = useNotificationStore(
     useShallow((state) => {
       const events = profileId ? state.profileEvents[profileId] : undefined;
       if (!events?.length) return NO_MONITOR_EVENTS;
       return events.filter((e) => String(e.MonitorId) === monitorId);
     })
   );

A Zustand selector runs on every store change and re-renders the component only
when what it returns differs from last time. ``filter`` builds a new array each
call, so a plain equality check would see a new reference every time any
monitor anywhere alarmed. ``useShallow`` compares the array element by element
instead, and ``NO_MONITOR_EVENTS`` is a module-level constant so the empty case
returns the same reference forever. Without both, an event on camera 4 would
re-render all twenty-five tiles. See :doc:`03-state-management-zustand`.

When a newly arrived event is younger than ``MONITOR_UI.alarmPulseMs``
(6000 ms), the tile sets ``isAlarming``, which adds the ``montage-alarm-pulse``
class to the header, and clears it on a timer.

MontageTileErrorBoundary
~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/montage/MontageTileErrorBoundary.tsx``

If one tile throws while rendering, the montage grid should lose that tile and
nothing else. ``Montage.tsx`` wraps every ``MontageMonitor`` in this boundary,
which swaps the crashed tile for an alert icon, the monitor's name, and the
``montage.tile_error`` string, and logs through ``log.montageMonitor`` at
``LogLevel.ERROR``. Without it, the error would keep bubbling to the route
boundary and unmount the entire page.

This is written as a class:

.. code:: tsx

   export class MontageTileErrorBoundary extends Component<Props, State> {
     public state: State = { hasError: false };

     public static getDerivedStateFromError(): State {
       return { hasError: true };
     }

     public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
       log.montageMonitor('Tile render error', LogLevel.ERROR, {
         monitorId: this.props.monitorId,
         monitorName: this.props.monitorName,
         error,
         componentStack: errorInfo.componentStack,
       });
     }

     public render(): ReactNode {
       if (this.state.hasError) {
         return <TileErrorFallback monitorName={this.props.monitorName} />;
       }
       return this.props.children;
     }
   }

Catching a render error is the one thing React never gave hooks. A hook runs
*inside* the render that throws, so it cannot observe its own failure;
``getDerivedStateFromError`` and ``componentDidCatch`` are lifecycle methods
that only exist on classes. Every class component in this codebase is an error
boundary for that reason, and there are exactly three: ``ErrorBoundary``
(app-wide), ``RouteErrorBoundary`` (per route), and this one (per tile). The
fallback carries ``data-testid="montage-tile-error"``.

MonitorHoverPreview
~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/monitors/MonitorHoverPreview.tsx``

Mouse over a camera tile on the desktop Monitors page and a larger live preview
of that camera grows out of it. Hold a finger on the same tile on a phone and
the same preview appears. It is enabled per view through
``settings.hoverPreview.monitorsGrid`` and ``settings.hoverPreview.monitorsList``,
and it also wraps the dashboard's ``MonitorWidget``.

``MonitorHoverPreview`` is a thin adapter over the ``HoverPreview`` primitive
in ``components/ui/hover-preview.tsx`` (documented in
:doc:`12-shared-services-and-components`). It computes the monitor's aspect
ratio, honoring rotation, and passes a render prop:

.. code:: tsx

   <HoverPreview
     aspectRatio={aspectRatio}
     testId="monitor-hover-preview"
     renderPreview={() => <MonitorLivePreview monitor={monitor} />}
   >
     {children}
   </HoverPreview>

``HoverPreview`` draws the enlarged frame through a **portal**. A portal renders
a component's DOM output into a different place in the document while leaving
it exactly where it is in the React tree, so it still receives props and
context from its parent. That matters because the preview is drawn from inside
a grid cell that has ``overflow: hidden`` and its own stacking context. Rendered
in place it would be clipped to the tile it is trying to escape; rendered
through a portal into ``document.body`` it floats over the page.

The important part of that snippet is ``renderPreview`` being a function rather
than an element. ``HoverPreview`` calls it only while the preview is open, so
``MonitorLivePreview`` mounts on hover and unmounts on leave. That is what makes
the extra stream safe:

.. code:: tsx

   const { connKey } = useStreamLifecycle({
     monitorId: monitor.Id,
     monitorName: monitor.Name,
     portalUrl: currentProfile?.portalUrl,
     accessToken,
     viewMode: 'streaming',
     mediaRef: imgRef,
     logFn: log.monitor,
     enabled: true,
     minStreamingPort: effectiveMinStreamingPort,
     apiTimeoutSeconds: settings.apiTimeoutSeconds,
   });

Mounting mints a fresh ZMS connkey; unmounting fires ``useStreamLifecycle``'s
cleanup, which sends ``CMD_QUIT`` for it. The preview's ``nph-zms`` process dies
on the ZoneMinder server when the mouse leaves, instead of surviving as a
zombie.

Only two call sites use ``useStreamLifecycle`` directly: this component and
``hooks/useMonitorStream.ts``. Every other live view reaches it through
``useMonitorStream``, which ``LiveMonitorPlayer`` calls on the MJPEG path.
``useStreamLifecycle`` also registers each live stream with
``lib/monitor/active-streams.ts``, so a profile switch (``stores/profile.ts``)
can await ``quitAllActiveStreams()`` and quit every stream on the old server
while that server's token and TLS trust are still in effect.

How this goes wrong: zombie streams
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A connkey identifies one ``nph-zms`` process on the ZoneMinder server. The
number is generated in an effect, and effects run *after* React has painted the
first render. So on that first render ``connKey`` is still its initial ``0``. If
the ``<img src>`` is built unconditionally, the browser starts a stream with
``connkey=0``, then the effect sets a real key, the ``src`` changes, and the
browser starts a second stream. Only the second one has a key anyone can quit.
Viewing N monitors leaves N orphaned processes running until ZoneMinder's own
idle timeout reaps them.

The fix is a guard on the URL, not on the render. ``useMonitorStream`` never
produces a stream URL without a real key:

.. code:: tsx

   const streamUrl = currentProfile && connKey !== 0 && isAccessTokenFresh
     ? getStreamUrl(recordingUrl || currentProfile.cgiUrl, monitorId, { /* ... */ })
     : '';

The other half is teardown. Cleanup functions are created during render and
capture that render's values, so an unmount-only cleanup (``useEffect(..., [])``)
would close over the first render's ``connKey``, which is ``0``, and quit
nothing. ``useStreamLifecycle`` sidesteps this by writing the current values into
a ref on every change and reading the ref at unmount:

.. code:: tsx

   // Update cleanup params whenever they change
   useEffect(() => {
     if (!enabled) return;
     cleanupParamsRef.current = { monitorId, monitorName, connKey, portalUrl, /* ... */ };
   }, [enabled, monitorId, monitorName, connKey, portalUrl, /* ... */]);

   // Cleanup: send CMD_QUIT and abort image loading on unmount ONLY
   useEffect(() => {
     return () => {
       const params = cleanupParamsRef.current;
       void quitStreamForParams(params, logFn, 'unmount');
       if (mediaElRef.current) {
         mediaElRef.current.removeAttribute('src');
       }
     };
   }, []); // Empty deps = only run on unmount

A ref is the same box on every render, so reading ``.current`` in the cleanup
sees the latest connkey rather than the one captured when the cleanup was
created. ``removeAttribute('src')`` rather than ``src = ''`` because an empty
``src`` resolves to the page URL on some engines and fires a spurious request.

:doc:`call-flows` walks this same code in "Montage opens and a live MJPEG stream
runs".

Video playback
--------------

Three players exist because there are three distinct delivery protocols. Live
monitor streams negotiate go2rtc (WebRTC / MSE / HLS) and fall back to MJPEG.
Recorded events come in two shapes: either ZoneMinder produced an MP4
(``Videoed === '1'``), in which case Video.js handles it as MP4 or HLS, or only
JPEG frames are stored and the only way to play them back is the ZMS streaming
endpoint. EventDetail also exposes a user toggle (TV mode defaults to on) that
forces the ZMS path even when an MP4 is available.

The three player files sit next to their consumers. Live playback lives under
``components/monitors/``; event playback lives under ``components/events/``. The
file name carries the protocol so the selection at each call site is
self-evident from the import.

LiveMonitorPlayer
~~~~~~~~~~~~~~~~~

**Location**: ``src/components/monitors/LiveMonitorPlayer.tsx``

Live monitor player. Picks between go2rtc and MJPEG based on monitor
capabilities and user preference. Consumed by ``MonitorCard``,
``MontageMonitor``, the dashboard ``MonitorWidget``, and the ``MonitorDetail``
page.

**Props (from ``LiveMonitorPlayerProps``):**

.. code:: tsx

   export interface LiveMonitorPlayerProps {
     monitor: Monitor;
     profile: Profile | null;
     className?: string;
     objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
     showControls?: boolean;
     externalMediaRef?: React.RefObject<HTMLImageElement | HTMLVideoElement | null>;
     muted?: boolean;
     onLoad?: () => void;
     onProtocolChange?: (protocol: string) => void;
     forceViewMode?: 'streaming' | 'snapshot';
   }

**Protocol selection.** go2rtc is used when the user's ``streamingMethod`` is
not ``'mjpeg'``, ``monitor.Go2RTCEnabled`` is true, and the profile has a
``go2rtcUrl``. A per-monitor override in ``monitorStreamingOverrides`` wins over
the global setting. Otherwise MJPEG. The go2rtc hook (``useGo2RTCStream``) tries
WebRTC then MSE then HLS in order and reports the active protocol back via
``onProtocolChange``.

**Failure cache.** A module-level ``go2rtcFailureCache`` records the last
failure timestamp per ``monitor.Id``. While that entry is younger than
``GO2RTC_RETRY_INTERVAL_MIN`` (5 minutes, declared at the top of
``LiveMonitorPlayer.tsx``), the player skips go2rtc entirely and starts on
MJPEG. This avoids montage grids re-attempting WebRTC on every tile every
render. The cache is cleared immediately when the user explicitly switches a
monitor's preference back to go2rtc, so a manual retry does not have to wait
out the window.

**No-frame fallback.** After go2rtc reports ``connected``, the player arms a
timer for ``GO2RTC_VIDEO_TIMEOUT_S`` (15 seconds, in
``lib/zmninja-ng-constants.ts``; generous because in montage every tile connects
at once). When it fires the player inspects ``videoWidth`` / ``videoHeight`` on
the underlying ``<video>``. Zero dimensions count as a soft failure: the monitor
is marked failed and MJPEG takes over. Nonzero dimensions with the video paused
trigger a single ``video.play()`` attempt to recover from autoplay
restrictions. A separate poll every ``GO2RTC_FRAME_POLL_MS`` (250 ms) checks the
same dimensions while the MJPEG-first placeholder shows, so a healthy stream
swaps over as soon as frames decode rather than waiting out the 15 seconds.

**Test IDs.** The outer wrapper carries ``data-testid="video-player"``. Internal
states expose ``video-player-loading``, ``video-player-webrtc-container``,
``video-player-mjpeg``, ``mse-connecting-badge``, ``video-player-error``, and
``video-player-retry``. E2E step definitions in
``tests/steps/monitor-detail.steps.ts`` and ``tests/steps/events.steps.ts`` bind
to these IDs, so renaming any of them breaks the cross-platform suite.

Mp4EventPlayer
~~~~~~~~~~~~~~

**Location**: ``src/components/events/Mp4EventPlayer.tsx``

Video.js wrapper for recorded event playback. Consumed only by ``EventDetail``,
on the MP4 / HLS branch.

**Props:**

.. code:: tsx

   interface Mp4EventPlayerProps {
     src: string;
     type?: string;
     poster?: string;
     className?: string;
     autoplay?: boolean | 'muted' | 'play' | 'any';
     controls?: boolean;
     muted?: boolean;
     aspectRatio?: string;
     markers?: VideoMarker[];
     onMarkerClick?: (marker: VideoMarker) => void;
     onReady?: (player: Player) => void;
     onError?: (error: unknown) => void;
     eventId?: string;
   }

Markers are rendered via ``videojs-markers``; the ``markers`` array maps to
alarm / max-score frames on the event timeline and ``onMarkerClick`` seeks to a
frame. ``videojs-markers`` (v1.x) is a Video.js basic plugin registered with
``videojs.plugin()``; its plugin function reads ``this`` as the player
(``S = this; S.on('loadedmetadata', ...)``), so it must be invoked as a method
(``player.markers(opts)``). Calling it detached
(``const f = player.markers; f(opts)``) leaves ``this`` undefined and throws,
which is what produced the recurring "Failed to update video markers" errors on
events that have markers. On init the plugin replaces ``player.markers`` with an
API object, so a function value means "not initialized". The
``applyVideoJsMarkers`` helper in ``lib/event/video-markers.ts`` initializes once
via a method call and uses ``removeAll()`` / ``add()`` for later updates. Marker
updates are gated on the player's ready callback (the plugin reads the player
DOM), ``onMarkerClick`` is read through a ref inside a stable click handler so a
changing callback identity does not force a re-init, and a value signature skips
redundant re-applies when a react-query refetch hands back a fresh ``markers``
array with unchanged values. Source, poster, and autoplay changes propagate
through a separate update effect that diffs against ``player.currentSrc()``
before reassigning, so token refresh does not restart playback on iOS WKWebView.

Picture-in-Picture, and why it uses Context
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/contexts/PipContext.tsx``

Start an event playing, pop it out to Picture-in-Picture, then navigate back to
the events list. The little floating window keeps playing. That works because
the ``<video>`` element is physically moved out of the page that is about to
unmount.

``PipProvider`` wraps the app in ``App.tsx`` and renders a hidden ``div`` as a
sibling of the router:

.. code:: tsx

   <PipContext.Provider value={{ adoptForPip, reclaimFromPip, closePip, activePipEventId, /* ... */ }}>
     {children}
     {/* Hidden portal for adopted PiP elements: sibling of children, outside router */}
     <div ref={portalRef} style={{ display: 'none' }} data-testid="pip-portal" />
   </PipContext.Provider>

``adoptForPip(player, videoEl, eventId)`` finds the ``video-js`` wrapper around
the ``<video>``, remembers the DOM node it currently lives under
(``originHost``), and appends it to that hidden div. Because the div belongs to
the provider and not to the route, unmounting ``EventDetail`` does not take the
video with it. ``reclaimFromPip()`` hands the player and element back when the
same event is opened again; ``closePip()`` disposes both.

Chapter 3 taught Zustand for state shared across the tree, and PiP is shared
state, so why Context here? Because what is shared is not data. It is a live
``HTMLVideoElement``, a Video.js ``Player`` instance, and the identity of a DOM
node that only exists because a component rendered it. Zustand stores hold plain
values that selectors compare and components re-render on; none of that applies
to an element handle. React **Context** is the mechanism for a component to
publish something to its whole subtree, and here the thing being published is
tied to the provider's own DOM output. ``usePip()`` reads it:

.. code:: tsx

   export function usePip(): PipContextValue {
     const ctx = useContext(PipContext);
     if (!ctx) throw new Error('usePip must be used within PipProvider');
     return ctx;
   }

Unlike a store, a context has no selector: any component calling ``usePip()``
re-renders whenever the provider's value changes. That is affordable only
because the value changes on PiP enter and exit and nothing else.

``Mp4EventPlayer`` is the only consumer, gated on its ``eventId`` prop. Android
uses a custom control-bar button that triggers native ExoPlayer PiP via
``enterAndroidPip``; desktop and iOS use the browser ``enterpictureinpicture``
event. ``LiveMonitorPlayer`` does not use PiP.

ZmsEventPlayer
~~~~~~~~~~~~~~

**Location**: ``src/components/events/ZmsEventPlayer.tsx``

Player for events backed by ZoneMinder's ZMS streaming endpoint
(``cgi-bin/nph-zms``). ZMS serves a progressive JPEG stream and accepts control
commands (PAUSE, PLAY, SEEK, FASTFWD, etc.) over a separate URL keyed by
``connkey``. Consumed only by ``EventDetail``, on the JPEG-only branch and on
the user-forced-ZMS branch.

**Props:** ``portalUrl``, ``eventId``, ``token``, ``apiUrl``, ``totalFrames``,
``alarmFrames``, ``alarmFrameId``, ``maxScoreFrameId``, ``eventLength``,
``minStreamingPort``, ``monitorId``, ``className``, ``suspended``.

``suspended`` pauses the stream while something covers it, currently the
full-size viewer in ``EventFrameCarousel``. The effect remembers whether the
stream was running when suspension began and only sends ``CMD_PLAY`` on release
if it was, so a stream the user paused stays paused. It depends on ``suspended``
alone and reads ``isPlaying`` without depending on it; taking ``isPlaying`` as a
dependency would re-run the effect on every ordinary play/pause.

The player exposes transport controls (start, seek back 5s, play / pause, seek
forward 5s, end), speed presets (0.25x, 0.5x, 1x, 2x, 4x), a frame-position
scrubber with alarm-frame markers, and jump buttons for the first alarm frame
and the max-score frame. Playback position is tracked by polling
``ZMS_COMMANDS.cmdQuery`` (``lib/zm/zm-constants.ts``) through
``getZmsControlUrl`` at the bandwidth-aware ``zmsStatusInterval``; the poll
shares an ``AbortController`` with its in-flight ``httpGet`` calls so unmount
cancels them.

Seeks use the duration the stream reports back in that query, not the DB
``eventLength`` prop. The two can disagree on variable-rate or still-recording
events, and seeking against ``eventLength`` lands the playhead at the wrong spot
(refs #196). ``eventLength`` is the fallback until the first query returns. While
the scrub bar is held (``onScrubStart``/``onScrubEnd`` on ``EventProgressBar``),
the status poll is suspended so it does not fight the drag. Each scrub position
is a bare ``CMD_SEEK``; the seek drives playback by itself, with no surrounding
pause or resume.

A settled seek is repeated once to the same offset after
``EVENT_SEEK_FLUSH_DELAY_MS`` (400 ms) unless the stream is confirmed to be
advancing (``isPlaying`` with a known ``streamDuration``). MJPEG in an ``<img>``
only paints a multipart part once the next part's boundary starts arriving, and
a paused or idle zms only emits its next frame on its ``MAX_STREAM_DELAY``
keepalive (5 s), so a lone seek to a stopped stream shows its frame about 5 s
late. Newer zms sends the sought frame twice to fix this server-side; ZM 1.36
does not, so the repeat supplies the second frame that flushes the first. A
newer seek cancels a still-pending repeat, so a drag only flushes its final
resting position.

URL construction is gated on a fresh access token via ``useFreshAccessToken``.
When the token is stale, ``zmsUrl`` evaluates to ``''`` and the ``<img>`` does
not render until the auth store returns a refreshed value. See the access-token
freshness gate in :doc:`07-api-and-data-fetching` for why this gate exists and
what counts as fresh.

EventFrameCarousel
~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/events/EventFrameCarousel.tsx``

Strip of the significant still frames for an event, rendered above the player in
``EventDetail`` (refs #272). The candidates are ``EVENT_FRAME_TYPES``
(``lib/zmninja-ng-constants.ts``), rendered in that array's order, most
informative first: ``objdetect``, ``alarm``, ``snapshot``. Each
one becomes a thumbnail through ``getEventImageUrl`` at
``EVENT_FRAME_THUMB_WIDTH`` (240 px), and the full-size viewer requests the same
URL without a width.

**Props:** ``portalUrl``, ``eventId``, ``token``, ``apiUrl``,
``minStreamingPort``, ``monitorId``, ``hasAlarmFrame``, ``onViewerOpenChange``.

ZoneMinder has no endpoint that reports which of these frames a given event has.
``objdetect`` only exists when the Event Server or ``zm_detect`` wrote one, and
the alarm frame only exists for an event that alarmed. So presence is discovered
by rendering: a thumbnail whose ``<img>`` fires ``onError`` adds its type to a
``failed`` list and disappears, and the component returns ``null`` once nothing
is left, which removes the card entirely. ``hasAlarmFrame`` skips the alarm
candidate up front when the event carries no ``AlarmFrameId``, so the common
non-alarm case costs no failed request. ``EventDetail`` renders the carousel
only while ``isAccessTokenFresh``, otherwise a token refresh would fail every
image at once and hide the card for the rest of the visit.

Collapse state lives in ``CollapsibleCard`` under
``EVENT_FRAMES_OPEN_STORAGE_KEY``, so it is a device preference in
``localStorage`` rather than a profile setting: it describes screen layout, not
server behavior.

``onViewerOpenChange`` is how the covered player gets stopped. ``EventDetail``
holds the Video.js instance from ``Mp4EventPlayer``'s ``onReady`` in a ref typed
structurally (``paused``/``play``/``pause``) so the page does not import
``video.js`` itself, pauses it when the viewer opens, and resumes it on close
only if it had been playing. The ZMS branches receive the same state through
``suspended``.

Player selection in EventDetail
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The branch in ``src/pages/EventDetail.tsx`` reduces to:

.. code:: tsx

   {hasVideo ? (
     useZmsFallback ? (
       <ZmsEventPlayer ... />
     ) : (
       <Mp4EventPlayer src={videoUrl} ... />
     )
   ) : hasJPEGs ? (
     <ZmsEventPlayer ... />
   ) : (
     /* no media */
   )}

``hasVideo`` is ``!!(event?.Event.DefaultVideo || event?.Event.Videoed === '1')``.
``hasJPEGs`` is ``event.Event.SaveJPEGs !== null && event.Event.SaveJPEGs !== '0'``.
``useZmsFallback`` initializes to ``isTvMode || Platform.isTVDevice`` and is
toggleable from the EventDetail header; an effect forces it back on whenever
``isTvMode`` becomes true, because the Fire Stick WebView renders MP4 poorly.

Working with events
-------------------

CompactEventRow
~~~~~~~~~~~~~~~

**Location**: ``src/components/events/CompactEventRow.tsx``

One row in the recent-events list under a monitor's live view: thumbnail, what
was detected, event id, start time, relative time, score, delete button.
Clicking it (or pressing Enter or Space while it is focused) opens
``/events/<id>`` with ``state: { from: '/monitors/<monitorId>' }``, so the event
page's back action returns to the monitor rather than the events list.

The primary text line comes from ``parseDetectedObjects(event.Notes)``
(``src/lib/event/event-detection.ts``). ZoneMinder writes detections into the
free-text ``Notes`` field as ``"detected:person,car|Motion: All"``; the function
matches everything after ``detected:``, splits on commas, and keeps only the
part before ``|`` in each entry, returning ``[]`` when there is no ``detected:``
segment. Classes it finds are joined with commas and shown with an icon from
``getObjectClassIconFromList``; otherwise the row falls back to ``event.Cause``.

The second line is the start time via ``fmtTime`` from ``useDateTimeFormat()``,
followed by a relative time (``formatEventRelative``) when the event falls
within ``RELATIVE_TIME_LIST_WINDOW_DAYS`` (7 days, checked with ``isWithinDays``).
User-visible times always go through the hook so the profile's date and time
format settings apply.

**Test ids**: row ``compact-event-row``, thumbnail ``compact-event-thumbnail``.

The row reads ``selectedForDelete`` from ``useDeleteSelectionStore`` and adds
``ring-2 ring-destructive/60 bg-destructive/5`` when the event is queued for
deletion. That class is listed after the return-flash classes in the row's
``cn(...)`` call, so a queued row that is also mid-flash shows the destructive
ring rather than the flash styling.

Return highlight
~~~~~~~~~~~~~~~~

**Location**: ``src/stores/returnHighlight.ts``, ``src/hooks/useReturnFlash.ts``,
``src/components/events/ReturnFlashArrow.tsx``

Open an event from a list, then navigate back. The row you came from blinks for
four seconds so you can find your place again. Three pieces implement it.

``useReturnHighlightStore`` is a Zustand store holding
``lastViewedEventId: string | null``, with ``markViewed(eventId)`` and ``clear()``
actions. It is session-only and not persisted. ``CompactEventRow``, ``EventCard``
and the grid view's ``EventMontageTile`` all call ``markViewed(event.Id)`` in
their open handler, before ``navigate``. The first two also do it on Enter/Space
activation.

``useReturnFlash(eventId: string): boolean`` subscribes reactively to
``lastViewedEventId``. When that id becomes ``eventId``, the hook flips its
returned boolean to ``true`` and starts a ``window.setTimeout`` that flips it
back after ``RETURN_FLASH_MS`` (4000 ms, in ``lib/zmninja-ng-constants.ts``). It
reacts to the store rather than capturing the id at mount because the returning
row's mount does not reliably line up with when the id is set, so a mount-time
read saw the wrong value. The id is consumed (``clear()``) when the flash ends,
and only if it still matches ``eventId``, so exactly one row flashes once per
return. The timer is cancelled only on unmount: the row that set the id then
navigates away, and dropping its pending timer without consuming keeps the id
available for the row that flashes on return.

``ReturnFlashArrow`` renders a decorative ``Triangle`` icon (``aria-hidden``,
test id ``return-flash-indicator``), absolutely positioned at ``-top-1.5`` and
centered, so it sits just above its anchor and points down at it. The blink is
``motion-safe:animate-blink``: the ``motion-safe:`` gate gives users with
``prefers-reduced-motion`` a static arrow instead of a blinking one, so it must
not be removed. Because the arrow is absolutely positioned, its parent needs
``relative``: in ``CompactEventRow`` and ``EventCard`` that is the ``relative``
wrapper around the thumbnail, which does not clip. ``EventMontageTile``'s
``Card`` does clip (``overflow-hidden``), so the arrow is rendered as a sibling
of the ``Card`` inside a ``relative`` wrapper. Putting it inside would clip the
half that overhangs the top edge. All three render ``<ReturnFlashArrow />``
when their local ``flash`` boolean is ``true``, half above the thumbnail.

Hooks cannot be called from inside a ``.map()`` callback, so a grid or list that
needs a per-row ``useReturnFlash`` must give each row its own component.
``EventMontageView`` extracts ``EventMontageTile`` for this reason, the same way
``EventListView`` extracts ``EventItem``.

Bulk event delete
~~~~~~~~~~~~~~~~~

Deleting events is a batch operation (refs #213): clicking the trash icon on a
row queues it rather than opening a per-event confirm dialog. A bar floats up
from the bottom with the count and a Delete button. Four pieces implement this.

``useDeleteSelectionStore`` (``src/stores/deleteSelection.ts``) holds
``selectedIds: string[]`` with ``toggle(eventId)`` and ``clear()``. It is
session-only, not persisted, and survives navigation on purpose: opening an
event from the queued list does not clear the selection. It clears on Cancel or
after a successful bulk delete.

``EventDeleteButton`` (``src/components/events/EventDeleteButton.tsx``) is a
trash icon toggle, not a dialog trigger. It reads whether its ``eventId`` is in
``selectedIds`` and calls ``toggle`` on click, stopping propagation so it never
fires the parent row's click-to-navigate handler. Selected state fills the icon
(``fill-destructive text-destructive``) and sets ``aria-pressed``. Used by both
``CompactEventRow`` and ``EventCard``.

**Props**: ``eventId``, ``size`` (``'sm' | 'md'``, default ``'md'``),
``className``. **Test id**: ``event-delete-button``.

``DeleteBatchBar`` (``src/components/events/DeleteBatchBar.tsx``) is rendered
once, in ``AppLayout``, so it floats above every page rather than being
duplicated inside each list. It reads ``selectedIds`` and renders nothing when
the array is empty. Otherwise it shows a pill with the queued count
(``events.delete_selected``, pluralized), a Cancel button calling ``clear()``,
and a Delete button that calls ``useBulkDeleteEvents`` then ``clear()``. Delete
is disabled while ``isDeleting``. **Test ids**: ``delete-batch-bar``,
``delete-batch-cancel``, ``delete-batch-confirm``.

``useBulkDeleteEvents`` (``src/hooks/useBulkDeleteEvents.ts``) exposes
``deleteEvents(eventIds: string[]): Promise<void>`` and ``isDeleting``. It calls
the API layer's ``deleteEvent`` (imported as ``apiDeleteEvent`` to avoid a name
clash) for every id through ``Promise.allSettled``, so one failed deletion does
not stop the rest. It then edits the cache twice, for two different reasons:

.. code:: tsx

   // Remove the successfully deleted events from cached lists right away so
   // the UI reflects the deletion immediately, then invalidate to reconcile.
   queryClient.setQueriesData(
     {
       predicate: (q) =>
         q.queryKey[0] === 'events' || q.queryKey.includes('monitorRecentEvents'),
     },
     (old) => removeFromEventsCache(old, deletedIds)
   );

   await Promise.all([
     queryClient.invalidateQueries({ queryKey: queryKeys.events(currentProfile?.id) }),
     ...eventIds.map((id) =>
       queryClient.invalidateQueries({ queryKey: queryKeys.event(currentProfile?.id, id) })),
     queryClient.invalidateQueries({
       predicate: (q) => q.queryKey.includes('monitorRecentEvents'),
     }),
   ]);

React Query keeps a cache of server responses keyed by an array
(:doc:`07-api-and-data-fetching`). ``setQueriesData`` rewrites the cached value
in place, so the rows vanish on the next paint. ``invalidateQueries`` marks the
same queries stale and refetches them, which reconciles with whatever the server
actually did. Doing only the second would leave deleted rows on screen for a
round trip; doing only the first would let a failed server-side delete disappear
from the UI and stay gone.

The keys come from the ``queryKeys`` factory in ``lib/query/query-keys.ts``, never
written inline. The last invalidation uses a predicate rather than a key because
it has to reach every monitor's recent-events query, not just this event's
monitor.

If any deletion failed, the hook logs via ``log.eventCard`` and toasts
``events.delete_failed``; otherwise it toasts ``events.delete_selected_success``,
pluralized on the count.

MonitorRecentEvents
~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/monitors/MonitorRecentEvents.tsx``,
``src/hooks/useMonitorRecentEvents.ts``

Below the live view on a monitor's page, and below the PTZ controls when the
camera has them, sits a collapsible list of that monitor's newest events. The
header (title, refresh button, collapse toggle, "All events" link) always
renders; the body collapses, and the collapsed state is remembered per monitor.

Collapsing does more than hide the rows. The body unmounts and the query behind
it is disabled, so a collapsed list issues no requests and no background
refreshes:

.. code:: tsx

   const { data, isLoading, isError, isFetching, refetch } = useQuery({
     queryKey: queryKeys.monitorRecentEvents(currentProfile?.id, monitorId, count),
     queryFn: () => getEvents({ monitorId, limit: count, sort: 'StartDateTime', direction: 'desc' }),
     enabled: !!currentProfile && isAuthenticated && !hidden,
     refetchInterval: hidden ? false : bandwidth.monitorRecentEventsInterval,
   });

``sort: 'StartDateTime', direction: 'desc'`` puts the newest first regardless of
the server's default sort. ``count`` is
``clampRecentEventsCount(settings.monitorDetailRecentEventsCount)`` and is part
of the key, so changing the row count is a different query rather than a
re-slice of an old one. ``refetchInterval`` comes from ``useBandwidthSettings()``
(30 seconds normally, 60 seconds in low-bandwidth mode, per
``BANDWIDTH_SETTINGS``), never a hardcoded number.

``toggleHidden()`` flips the collapsed state for this monitor and persists it
through ``updateProfileSettings``, so it is scoped to the active profile.

React Query v5 reports ``isLoading`` as ``false`` for a disabled query. That is
harmless here because ``MonitorRecentEvents`` only renders the body, and only
reads ``isLoading``, when ``hidden`` is ``false``.

**Test ids**: root ``monitor-recent-events``, collapse toggle
``monitor-recent-events-toggle``, refresh ``monitor-recent-events-refresh``,
"All events" ``monitor-recent-events-all``, body ``monitor-recent-events-body``.

The dashboard
-------------

DashboardWidget
~~~~~~~~~~~~~~~

**Location**: ``src/components/dashboard/DashboardWidget.tsx``

Every dashboard tile is wrapped in ``DashboardWidget``, which supplies the card
chrome and, in edit mode, a pencil, an X, and a drag handle. The two buttons
overlap the drag surface, so both of their handlers stop propagation twice:

.. code:: tsx

   <Button
     onClick={(e) => {
       e.stopPropagation(); // Prevent drag start
       setEditDialogOpen(true);
     }}
     onMouseDown={(e) => e.stopPropagation()} // Prevent drag start
   >

``react-grid-layout`` begins a drag on ``mousedown``, not on ``click``, so
stopping only the click would still drag the widget out from under the cursor
while opening the dialog.

DashboardLayout, and a loop worth knowing about
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/dashboard/DashboardLayout.tsx``

``DashboardLayout`` renders the widgets into ``react-grid-layout``. Widget
positions live in the Zustand dashboard store (they persist across reloads), but
the grid library wants to own a ``layout`` array in component state and calls
``onLayoutChange`` whenever it moves anything. That is two sources of truth
pointed at each other, and wiring them naively spins forever:

1. Store changes, so the sync effect runs and calls ``setLayout``.
2. The grid sees a new layout and calls ``handleLayoutChange``.
3. ``handleLayoutChange`` writes to the store.
4. Back to step 1.

The break is a ref that records whether the current ``setLayout`` originated
from the store or from the user:

.. code:: tsx

   useEffect(() => {
     // Mark that we're syncing from store - this prevents handleLayoutChange from
     // writing back to store and causing an infinite loop
     isSyncingFromStoreRef.current = true;
     setLayout((prev) => (areLayoutsEqual(prev, layouts) ? prev : layouts));
     // Reset the flag after React has processed the state update
     // Use requestAnimationFrame for more predictable timing than queueMicrotask
     requestAnimationFrame(() => {
       isSyncingFromStoreRef.current = false;
     });
   }, [layouts, areLayoutsEqual]);

   const handleLayoutChange = useCallback((nextLayout: Layout[]) => {
     setLayout((prev) => (areLayoutsEqual(prev, nextLayout) ? prev : nextLayout));
     if (!isEditing || isSyncingFromStoreRef.current) return;
     updateLayouts(profileIdRef.current, { lg: nextLayout });
   }, [areLayoutsEqual, isEditing]);

The flag has to stay up long enough for the grid's callback to run and no
longer. ``queueMicrotask`` can fire before React finishes processing the state
update, and ``setTimeout(..., 0)`` is at the mercy of the task queue.
``requestAnimationFrame`` fires after the current frame's DOM updates, by which
point React has committed the change and the grid has already called back.
``areLayoutsEqual`` is belt and braces: it returns the previous array reference
when nothing moved, so an identical layout does not even produce a re-render.

The store subscription itself uses ``useShallow`` for the same reason
``MontageMonitor`` does, and ``profileId`` is minted with ``asProfileId()``
because ``'default'`` (the no-profile-selected placeholder) is not a real
profile id. :doc:`call-flows` traces a widget end to end in "A Dashboard
widget".

Widget types
~~~~~~~~~~~~

Each widget is a child of ``DashboardWidget`` and reads its own configuration
out of ``widget.settings``:

- **MonitorWidget** (``widgets/MonitorWidget.tsx``): live streams for one or
  more monitors, via ``LiveMonitorPlayer`` (wrapped in ``MonitorHoverPreview``).
  Configuration: ``monitorIds``, ``feedFit``.
- **EventsWidget** (``widgets/EventsWidget.tsx``): a recent-events list.
  Configuration: ``monitorIds``, ``eventCount``, ``refreshInterval``,
  ``onlyDetectedObjects``, ``tagIds``.
- **HeatmapWidget** (``widgets/HeatmapWidget.tsx``): event frequency by day and
  hour.
- **TimelineWidget** (``widgets/TimelineWidget.tsx``): event timeline.

Platform gotcha: invisible overlays swallow taps on iOS
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``MonitorWidget`` draws a caption strip over the bottom of each stream that
fades in on hover. On desktop, hover makes it visible before any click lands, so
nothing is amiss. On iOS there is no hover: the strip stays at ``opacity-0``,
and an ``opacity-0`` element still hit-tests. Tapping the monitor hits the
invisible strip and the tap goes nowhere.

The fix is on the element, not the parent:

.. code:: tsx

   <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">

Any ``opacity-0`` element sitting over interactive content needs
``pointer-events-none``. Add ``group-hover:pointer-events-auto`` back if it must
accept input once visible. ``EventHeatmap``'s tooltip carries the same pair.
Invisible is not the same as non-interactive, and only a real iOS device shows
the difference.

Hiding monitors
---------------

HiddenMonitorsSection
~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/settings/HiddenMonitorsSection.tsx``

A per-profile control to hide and restore monitors. Hidden monitors drop out of
monitor lists, events, montage, and timeline for the active profile. The setting
is ``excludedMonitorIds`` on the profile's settings.

The section has to list every monitor including the hidden ones, or a hidden
monitor could never be restored. It fetches the unfiltered list under its own
key so the result never overwrites the filtered monitors cache the rest of the
app reads:

.. code:: tsx

   const { data } = useQuery({
     queryKey: queryKeys.monitorsAllIncludingExcluded(currentProfile?.id),
     queryFn: () => getMonitors({ includeExcluded: true }),
     enabled: !!currentProfile && isAuthenticated,
   });

``queryKeys.monitorsAllIncludingExcluded`` produces
``['monitors', profileId, 'all-including-excluded']``, which sits *under* the
``['monitors', profileId]`` domain prefix. React Query invalidates by prefix, so
invalidating the monitors domain reaches this query too, while a fetch of this
query cannot clobber the domain-level cache entry.

Toggling a row updates ``excludedMonitorIds``, then invalidates
``queryKeys.monitors``, ``queryKeys.events``, ``queryKeys.monitorEventsSinceAll``,
``queryKeys.timelineEvents``, and ``queryKeys.eventMontage`` for the current
profile, so every dependent view refetches with the new exclusion applied.

**Test ids**: ``hidden-monitors-list``, ``hidden-monitors-count``,
``hidden-monitor-row-<id>``, ``hidden-monitor-toggle-<id>``.

Kiosk mode
----------

Kiosk mode locks the UI so the current view stays visible and live-updating
while navigation and interaction are blocked. It is activated from the sidebar
lock icon or the fullscreen montage controls.

KioskOverlay
~~~~~~~~~~~~

**Location**: ``src/components/kiosk/KioskOverlay.tsx``

A full-screen transparent overlay rendered on top of the app when
``kioskStore.isLocked`` is ``true``, and ``null`` otherwise. The view underneath
keeps updating (streams, event counts); only interaction is blocked.

- Covers the viewport at ``Z_INDEX.overlay`` (9999) with ``pointer-events: auto``
- Intercepts browser back navigation (pushState trick) so the user cannot leave
  the locked view
- On Android, swallows the hardware back button via an ``@capacitor/app``
  listener (dynamic import, native platforms only)
- Blocks keyboard shortcuts while locked, except when the PIN pad is open, so
  keyboard input still reaches ``PinPad``
- Shows a small unlock button (bottom-right). On tap it tries biometrics first
  and falls through to the PIN pad on failure or cancellation
- Calls the ``onUnlock`` prop after a successful unlock
- Watches ``unlockRequested`` in the kiosk store. When another element (the
  sidebar lock button) calls ``requestUnlock()``, the overlay picks it up, clears
  the flag via ``clearUnlockRequest()``, and starts the unlock flow itself

**Test ids**: ``kiosk-overlay``, ``kiosk-unlock-button``, ``kiosk-pin-pad``.

PinPad
~~~~~~

**Location**: ``src/components/kiosk/PinPad.tsx``

A 4-digit numeric keypad in a modal, used for both first-time setup and unlock.
``PinPadMode`` is ``'set'`` (choose a PIN), ``'confirm'`` (re-enter to verify), or
``'unlock'``. It auto-submits on the 4th digit after a 100 ms delay
(``KIOSK.pinAutoSubmitDelayMs``) so the filled dot renders first. PIN state
resets when ``mode`` or ``error`` changes.

``PinPad`` listens for ``keydown`` on ``window`` in the capture phase. Digits add,
Backspace deletes, Escape cancels; all three call ``preventDefault`` and
``stopPropagation`` so they never reach ``KioskOverlay``'s keyboard blocker.
Keyboard input is disabled during cooldown.

**Props**: ``mode``, ``onSubmit(pin)``, ``onCancel``, ``error``,
``cooldownSeconds`` (when > 0, shows a countdown and disables the digits).

**Test ids**: ``kiosk-pin-pad``, ``kiosk-pin-input``, ``kiosk-pin-digit-{0-9}``,
``kiosk-pin-cancel``, ``kiosk-pin-delete``.

useKioskLock
~~~~~~~~~~~~

**Location**: ``src/hooks/useKioskLock.ts``

Shared lock-activation logic for the sidebar and the fullscreen montage
controls, so neither call site duplicates the first-time PIN setup flow.

1. ``handleLockToggle`` checks whether a PIN is stored (``hasPinStored()``).
2. If not, it opens ``PinPad`` in ``'set'`` then ``'confirm'`` mode, stores the
   PIN via ``storePin()``, then activates kiosk mode.
3. If a PIN exists, it activates kiosk mode immediately.
4. On lock it enables insomnia (keep-screen-on) if it was off.

**Returns**: ``isLocked``, ``showSetPin``, ``setPinMode``, ``pinError``,
``handleLockToggle``, ``handleChangePin`` (replaces the PIN without locking),
``handleSetPinSubmit(pin)``, ``handleSetPinCancel``.

.. code:: tsx

   const {
     isLocked,
     showSetPin,
     setPinMode,
     pinError,
     handleLockToggle,
     handleChangePin,
     handleSetPinSubmit,
     handleSetPinCancel,
   } = useKioskLock({ onLocked: () => closeSidebar() });

useBiometricAuth
~~~~~~~~~~~~~~~~

**Location**: ``src/hooks/useBiometricAuth.ts``

Despite the name, two async functions rather than a React hook:

- ``checkBiometricAvailability(): Promise<boolean>`` returns ``true`` if the
  device has enrolled biometrics and the plugin is available.
- ``authenticateWithBiometrics(reason): Promise<{ success, error? }>`` prompts
  the system biometric UI.

On iOS and Android it uses ``@aparajita/capacitor-biometric-auth`` (Touch ID,
Face ID). On Electron and web it returns ``false`` / ``{ success: false }``. Both
functions catch every error and return a safe value, so callers never need their
own try/catch.

PIN set, change, and clear live in the Settings page (Advanced section), which
renders a "Kiosk PIN" row (``settings-kiosk-change-pin``,
``settings-kiosk-clear-pin``). Change and Clear verify identity first, with
biometrics if available and the current PIN otherwise; Clear then calls
``clearPin()`` from ``lib/kioskPin.ts``.

TV mode
-------

Best-effort d-pad support for Android TV and Fire TV. It layers a couple of
page-specific keymaps on top of the WebView's own spatial navigation. It is not
an app-wide focus-management system.

TvDetector (native plugin)
~~~~~~~~~~~~~~~~~~~~~~~~~~

**Location**:
``android/app/src/main/java/com/zoneminder/zmNinjaNG/TvDetectorPlugin.java``

A Capacitor plugin registered as ``TvDetector``, called from
``lib/tv/tv-spatial-nav.ts``. Two methods:

- ``isTV()``: true if ``UiModeManager.getCurrentModeType()`` equals
  ``UI_MODE_TYPE_TELEVISION``.
- ``enableSpatialNavigation()``: turns on the WebView's built-in spatial
  navigation by calling the hidden
  ``WebSettings.setSpatialNavigationEnabled(true)`` API via reflection, then
  makes the WebView focusable and requests focus.

lib/tv/tv-spatial-nav.ts
~~~~~~~~~~~~~~~~~~~~~~~~

- ``checkIsTV()``: checks ``Platform.isTVDevice`` first (a native-injected flag,
  or a user-agent match against ``tv``/``aft``/``stb``/``fire tv`` in
  ``lib/platform.ts``), then falls back to the plugin's ``isTV()`` on native
  platforms. Always ``false`` on web.
- ``enableSpatialNavigation()``: a no-op outside native platforms; swallows
  errors when the plugin is unavailable.

Wiring (AppLayout.tsx)
~~~~~~~~~~~~~~~~~~~~~~

- ``useTvMode()`` reads ``settings.tvMode``, a profile-scoped setting with a
  manual toggle in Settings > Appearance (``settings-tv-mode``).
- On mount, ``checkIsTV()`` runs once per profile switch. If the device is a TV
  and ``tvMode`` is off, ``updateProfileSettings`` turns it on.
- While TV mode is active, a ``tv-mode`` class is toggled on ``<html>``
  (``index.css`` raises the base font size to 20px and gives ``:focus-visible``
  elements a heavier ring, for 10-foot viewing), and ``enableSpatialNavigation()``
  is called once.

useTvKeyHandler
~~~~~~~~~~~~~~~

**Location**: ``src/hooks/useTvKeyHandler.ts``

Registers a ``window`` ``keydown`` listener, active only while ``isTvMode`` is
true. Pages pass a ``TvKeyMap``
(``{ ArrowLeft?, ArrowRight?, ArrowUp?, ArrowDown?, Enter? }``):

- A key with a handler in the map calls ``preventDefault()`` and runs the
  handler; a key without one falls through to the WebView's native spatial
  navigation.
- ``Enter`` has a built-in fallback even with no map entry: if the focused
  element is not natively clickable (``BUTTON``, ``A``, ``INPUT``, ``SELECT``,
  ``TEXTAREA``), it synthesizes a ``.click()`` on it. Combined with
  ``lib/tv/tv-a11y.ts``'s ``clickableProps()`` / ``handleKeyClick()``
  (``tabIndex={0}`` + ``role="button"`` + Enter/Space ``onKeyDown``), that lets
  ``div``/``span`` "buttons" such as monitor tiles respond to Enter.

``useTvMode`` (``src/hooks/useTvMode.ts``) returns ``{ isTvMode }`` from
``settings.tvMode``. It is a thin read of the profile-scoped setting, nothing
more.

Per-page keymaps
~~~~~~~~~~~~~~~~

- **Montage** (``src/pages/Montage.tsx``): arrow keys move a focused-tile index
  (``handleDpadNav``) through the grid; Enter navigates to that monitor's detail
  page. A separate effect calls ``.focus()`` on the tile's DOM node
  (``data-testid="montage-monitor-<id>"``) whenever the index changes, since the
  index is plain state, not real DOM focus.
- **Timeline** (``src/pages/Timeline.tsx``): arrow keys pan and zoom the canvas
  viewport (``panLeft``, ``panRight``, ``zoomIn``, ``zoomOut``) instead of moving
  between DOM elements. No ``Enter`` handler is registered, so Enter falls
  through to the synthesize-click default.
- **EventDetail** (``src/pages/EventDetail.tsx``) registers no keymap. It only
  reads ``isTvMode`` to force ZMS playback.

What this does not do
~~~~~~~~~~~~~~~~~~~~~

Pages without a ``TvKeyMap`` (Dashboard, Events, Settings) rely entirely on the
WebView's native spatial navigation moving focus between focusable elements. An
earlier, fuller d-pad/cursor implementation was removed as dead code; nothing in
the current tree depends on it.

Notifications
-------------

A camera trips an alarm and a toast slides in, or, if the app is closed, a
system notification arrives and tapping it opens that event. Two delivery modes
sit behind that, and ``src/components/NotificationHandler.tsx`` is the component
that turns either one into UI.

**The two modes.** In **ES (Event Server)** mode the app holds a WebSocket to
the zmeventnotification server and receives events in real time, with FCM push
on iOS and Android. It is the default. In **Direct** mode there is no Event
Server: ZoneMinder's own Notifications REST API registers the FCM token and
pushes directly, and desktop and web fall back to polling ``/api/events.json``.

**The stack.**

- Native layer: Firebase Cloud Messaging via ``@capacitor-firebase/messaging``
- WebSocket service: ``src/services/notifications.ts`` (ES mode)
- Push service: ``src/services/pushNotifications.ts``, class ``MobilePushService``
- Event poller: ``src/services/eventPoller.ts`` (Direct mode, desktop and web)
- REST client: ``src/api/notifications.ts`` (Direct mode token registration)
- Store: ``src/stores/notifications.ts``
- Orchestrator: ``src/components/NotificationHandler.tsx``, which delegates to
  ``useNotificationAutoConnect``, ``useNotificationPushSetup``,
  ``useNotificationDelivered``, and ``useNotificationBadgeNudge``
- Settings UI: ``src/pages/NotificationSettings.tsx``, composing
  ``NotificationModeSection``, ``ServerConfigSection``, and
  ``MonitorFilterSection`` from ``components/notifications/``

**Registration.** In ES mode the app connects to the Event Server over the
WebSocket and authenticates; on mobile ``MobilePushService`` then requests FCM
permission, obtains a token, and sends it to the Event Server via the WebSocket
``push`` command. In Direct mode ``MobilePushService`` gets the same token but
registers it with ZoneMinder through ``POST /api/notifications.json`` (platform,
monitor list, push state); on desktop and web the event poller starts instead.

**Delivery.** Every path converges on one store action:

- Foreground, ES mode: the event arrives on the WebSocket.
  ``NotificationHandler`` watches the store and raises the toast. FCM duplicates
  are suppressed by a guard on ``isConnected``.
- Foreground, Direct mode on mobile: FCM's ``notificationReceived`` fires,
  ``MobilePushService`` parses the payload (it accepts both the ES and the ZM
  field shapes) and calls ``addEvent``. The store update raises the toast.
- Foreground, Direct mode on desktop: the poller calls ``addEvent``.
- Background or closed: tapping the system notification fires
  ``notificationActionPerformed``, and the handler calls
  ``navigationService.navigateToEvent()`` with state
  ``{ from: '/monitors', fromNotification: true }``. The ``from`` gives the back
  button somewhere to go when the history stack is empty, and
  ``fromNotification`` keeps the route out of ``lastRoute``.

Because four sources can report the same alarm, ``addEvent`` in the store
deduplicates on ``EventId``, dropping any existing entry before unshifting the
new one:

.. code:: tsx

   // Remove any existing event with the same ID to avoid duplicates
   // This prevents duplicate entries when receiving the same event from both WebSocket and FCM
   const otherEvents = current.filter((e) => e.EventId !== event.EventId);
   return [notificationEvent, ...otherEvents].slice(0, NOTIFICATIONS_SERVICE.maxEvents);

Events are stored per profile, and the list is capped at the newest 100
(``NOTIFICATIONS_SERVICE.maxEvents``). ``MontageMonitor``'s alarm pulse, above,
reads this same store.

``useNotificationBadgeNudge`` bridges this store to the new-events badge. It
watches ``events[0].EventId`` and, when a new one appears, invalidates
``queryKeys.monitorEventsSinceMonitor`` for that monitor, so its badge count
refetches within a second instead of at the 60000 ms poll. It runs independent of
the toast effect above (which is gated on ``settings.showToasts``) so the badge
moves with the bell whatever the toast setting, and it seeds its own last-seen id
on first run so a backlog present at mount does not fire a burst of invalidations.
:doc:`call-flows` Flow 18 places it in the badge's refetch path.

:doc:`call-flows` traces both halves: "A push notification, from registration to
tap" and "Live notifications over the Event Server websocket".

The in-app assistant (Ask)
---------------------------

Pressing ``?`` (or typing a leading ``?`` in the command palette, or its "Ask"
item) swaps the command palette into a chat, ``AskPanel``
(``components/assistant/AskPanel.tsx``), that answers questions about your
ZoneMinder server and, when you ask for a change, asks you to confirm it
first. :doc:`call-flows`'s "Asking the assistant a question" traces one send
end to end through ``lib/assistant/``; this section covers the component
pieces on the React side of that trace.

**Entry point.** ``KeyboardShortcuts.tsx``'s global ``?`` handler and
``CommandPalette.tsx``'s leading-``?`` input both call
``useCommandPaletteStore``'s ``openAsk()``, which flips the palette's ``mode``
to ``'ask'``; the palette then renders ``<AskPanel/>`` in place of its normal
results list, inside the same dialog shell. Neither entry point does anything
when the assistant is disabled in Settings (``settings.assistantEnabled``):
the ``?`` key falls back to the keyboard-shortcuts help overlay instead.

**Two shells around one body.** ``AskPanel`` is only the conversation body
(messages, input, cards). The window around it is one of two shells chosen at
runtime by viewport, because they need genuinely different JavaScript, not just
different CSS. ``AssistantWidget.tsx`` is a thin switch over
``useAssistantPanelStore``'s ``closed | minimized | open`` state: nothing,
a floating button, or a shell. ``useIsMobile`` (a ``matchMedia`` hook at the
``sm`` breakpoint) picks ``AssistantDesktopPanel`` (a resizable card pinned
bottom-right) or ``AssistantMobileSheet`` (a bottom sheet that shares the screen
with the app). The mobile sheet stores its height as a fraction of the visible
viewport so a rotation keeps its proportion, and uses ``useKeyboardViewport``
(a ``window.visualViewport`` wrapper, no Capacitor plugin) to hold the input
above the on-screen keyboard. Both shells embed the same ``<AskPanel/>`` and
share ``useAssistantChrome`` for the clear/minimize/close controls, so they
differ only in layout. The shell stays mounted (hidden) while minimized, so a
running turn survives collapsing to the button.

**Empty state and connection dot.** With an empty thread ``AskPanel`` renders
``AssistantIntro``: Ninjii's greeting plus a row of clickable example prompts
(``assistant.intro_example_1..4``, one of them "Summarize my day") that teach
the kind of question the assistant answers. A chip click fills the input rather
than sending, so the user can edit before the turn starts. Next to the backend
label in both shells sits ``OllamaStatusDot``, which renders nothing unless the
Ollama backend is selected. When it is, ``useOllamaHealth`` runs the same
``GET /models`` reachability probe as the Settings Test-connection button on the
bandwidth-scoped ``assistantHealthInterval`` (30s normal, 60s low) and the dot
shows green (reachable), red (unreachable), or a pulsing amber for the first
probe. The query is mounted only with the header, so it stops polling when the
panel closes; on-device WebLLM has no connection to report, so no dot appears
for it.

**Driving a turn.** ``AskPanel``'s ``handleSend`` appends the typed message to
the per-profile thread in ``useAssistantStore``, builds a system prompt from
the current profile's monitor list and ZM version (``buildSystemPrompt``),
and calls ``runAssistantTurn`` with an ``AbortController`` it owns. That same
controller's ``signal`` is what an abort or an unmount cancels, so the agent
loop never keeps generating for a panel that is gone.

**Rendering the model's answer.** ``agent.ts`` never renders user-facing text
itself; the only text it emits outside a normal reply is the sentinel
``__i18n:assistant.iteration_cap_reached`` when the tool-loop cap is hit.
``AskPanel`` is the one place that resolves that contract:

.. code:: tsx

   function renderAssistantText(text: string | undefined, t: TFunction) {
     if (!text) return null;
     if (text.startsWith(I18N_SENTINEL)) {
       return <p className="text-sm">{t(text.slice(I18N_SENTINEL.length))}</p>;
     }
     return <Markdown source={text} />;
   }

Every other assistant message renders as Markdown directly: the model writes
in the user's language already (the system prompt tells it to), so there is
no translation lookup for a normal reply, only for this one fixed sentinel
(rule 5's "never hardcode user-facing strings" still holds, it just applies
to the sentinel's key, not to arbitrary model output).

**The host has no confirm flow.** ``useAssistantHost``
(``components/assistant/useAssistantHost.ts``) is the ``AssistantHost``
implementation ``AskPanel`` hands to ``runAssistantTurn``. The assistant is
read-only: there are no destructive tools, so the confirmation flow an
earlier revision carried (``confirm``/``resolveConfirm`` and a confirm card)
no longer exists; a request to change something gets a plain refusal that
points at the right screen instead. ``navigate`` on the host minimizes the
assistant panel (``stores/assistantPanel.ts``) before routing, so an "Open"
click on an event or monitor result card collapses the panel to the FAB
instead of leaving a chat window open behind the page it just opened. The
assistant itself never routes the app: result cards are the only navigation
affordance.

**Used by:** ``CommandPalette.tsx`` (the only mount point). ``useAssistantStore``
holds the per-profile conversation thread and is not persisted, closing the
app clears it.

Test attributes
---------------

Interactive elements carry ``data-testid`` in kebab-case, and e2e steps bind to
those ids rather than to text or CSS classes:

.. code:: tsx

   <Card data-testid="monitor-card">
     <div data-testid="monitor-player" />
     <span data-testid="monitor-status" />
     <div data-testid="monitor-name">{monitor.Name}</div>
     <Button data-testid="monitor-events-button">{t('sidebar.events')}</Button>
     <Button data-testid="monitor-settings-button">{t('sidebar.settings')}</Button>
     <Button data-testid="monitor-download-button" />
   </Card>

Feature files stay in the language of the user:

.. code:: gherkin

   When I click on the first monitor card
   Then I should see the monitor player

Step definitions live in ``tests/steps/<screen>.steps.ts``, one file per screen
(``monitors.steps.ts``, ``monitor-detail.steps.ts``, ``montage.steps.ts``,
``events.steps.ts``, and so on), never a single shared module:

.. code:: tsx

   // tests/steps/monitors.steps.ts
   When('I click on the first monitor card', async ({ page }) => {
     await page.locator('[data-testid="monitor-card"]').first().click();
   });

See :doc:`06-testing-strategy` for how the same steps run against Chromium,
Android, and iOS.

Where the rest lives
--------------------

The shared primitives in ``components/ui/`` and ``components/common/``,
``NotificationBadge``, and the ``services/`` and ``lib/`` layers are documented
in :doc:`12-shared-services-and-components`. The React mechanisms used above
(``memo``, refs, effect cleanup, Context, portals, error boundaries, event
propagation) are taught from first principles in :doc:`02-react-fundamentals`,
and Zustand's selector model in :doc:`03-state-management-zustand`.
