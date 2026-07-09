Pages and Views
===============

A tour of the screens and the routing that connects them. A page here is
an ordinary function that returns markup for the current data; the router
decides which one runs, and nothing else about a page is special.

Routing
-------

``src/App.tsx`` is the only file in the codebase that renders a ``<Route>``.
Routes are declared in the ``AppRoutes`` component using React Router v7
(``react-router-dom``).

The router is a ``HashRouter``, so the route lives after a ``#``
(``#/monitors/3``). The Capacitor and Electron builds load ``index.html``
off the filesystem, where a path-based router would send the OS looking for
a file named ``/monitors/3``.

::

   /                       redirect to lastRoute (or /monitors), or /profiles, or /profiles/new
   /profiles/new           ProfileForm            (renders outside AppLayout)
   /setup                  redirect to /profiles/new

   -- inside AppLayout --
   dashboard               Dashboard
   monitors                Monitors
   /monitors/:id           MonitorDetail
   /montage                Montage
   /events                 Events
   /events/:id             EventDetail
   /event-montage          redirect to /events?view=montage
   /timeline               Timeline
   /profiles               Profiles
   /notifications          NotificationSettings
   /notifications/history  NotificationHistory
   /settings               Settings
   /server                 Server
   /logs                   Logs
   /developer-notice       DeveloperNotice

``dashboard`` and ``monitors`` are written without a leading slash. As
children of a pathless layout route they resolve against ``/`` and land in
the same place as their slash-prefixed siblings.

Layout routes and the Outlet
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

One ``<Route>`` in the table has no ``path`` of its own:

.. code:: tsx

   // src/App.tsx
   <Route element={<AppLayout />}>
     <Route path="dashboard" element={<Dashboard />} />
     <Route path="monitors" element={<Monitors />} />
     {/* ... */}
   </Route>

A route with an ``element`` but no ``path`` never matches a URL by itself.
It wraps its children. React Router renders ``AppLayout``, and wherever
``AppLayout`` renders ``<Outlet />`` (``src/components/layout/AppLayout.tsx``),
the matched child page appears. That single ``<Outlet />`` is how every page
in the table above gets the sidebar, the mobile header, and the
``OfflineBanner``, without a page importing any of them.

``/profiles/new`` sits outside the layout route on purpose: during first-run
setup there is no profile, so there is nothing for a sidebar to navigate to.

Code splitting with lazy and Suspense
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Every page component is imported through ``lazy``:

.. code:: tsx

   // src/App.tsx
   const Monitors = lazy(() => import('./pages/Monitors'));

   <Suspense fallback={<RouteLoadingFallback />}>
     <Routes>{/* ... */}</Routes>
   </Suspense>

``import()`` returns a promise, which tells the bundler to emit that page as
a separate JavaScript chunk that downloads the first time the user navigates
to it. Until the chunk arrives, a ``lazy`` component suspends, and the
nearest ``<Suspense>`` ancestor renders its ``fallback`` instead.
``RouteLoadingFallback`` (defined in ``App.tsx``) is a spinner over
``t('common.loading')``. The payoff is that a cold start ships the app shell
rather than all fifteen routed pages at once.

Crash isolation
~~~~~~~~~~~~~~~

Each page element is wrapped in a ``RouteErrorBoundary`` carrying the route
it guards:

.. code:: tsx

   <Route
     path="/timeline"
     element={
       <RouteErrorBoundary routePath="/timeline">
         <Timeline />
       </RouteErrorBoundary>
     }
   />

An exception thrown while one page renders is caught there. The sidebar and
every other route stay usable.

Programmatic navigation
~~~~~~~~~~~~~~~~~~~~~~~

``useNavigate`` returns a function you call with a path, or with a number to
move through history:

.. code:: tsx

   const navigate = useNavigate();
   navigate(`/monitors/${monitorId}`);            // forward
   navigate(-1);                                  // back
   navigate('/profiles', { replace: true });      // no new history entry

Reading route parameters
~~~~~~~~~~~~~~~~~~~~~~~~

``useParams`` hands back the dynamic segments of whichever route matched.
``MonitorDetail`` is reached through ``/monitors/:id``, so ``id`` is
whatever text filled that segment:

.. code:: tsx

   // src/pages/MonitorDetail.tsx
   const { id } = useParams<{ id: string }>();

Values are always strings, and always possibly ``undefined``, which is why
the queries below guard on ``!!id`` before they run.

Page structure
--------------

Pages live in ``src/pages/``:

::

   src/pages/
   ├── Dashboard.tsx             # Widget grid
   ├── DeveloperNotice.tsx       # Notices fetched from a feed
   ├── EventDetail.tsx           # Event playback
   ├── EventMontage.tsx          # (not routed, see below)
   ├── Events.tsx                # Event list / montage
   ├── Logs.tsx                  # App and ZM server logs
   ├── MonitorDetail.tsx         # Single monitor + live stream
   ├── Monitors.tsx              # Monitor list / grid
   ├── Montage.tsx               # Multi-monitor grid
   ├── NotificationHistory.tsx   # Past notifications
   ├── NotificationSettings.tsx  # Notification configuration
   ├── ProfileForm.tsx           # Create a profile
   ├── Profiles.tsx              # Select, edit, delete profiles
   ├── Server.tsx                # Server health and run state
   ├── Settings.tsx              # App settings
   ├── States.tsx                # (not routed, see below)
   └── Timeline.tsx              # Canvas timeline of events

``EventMontage.tsx`` and ``States.tsx`` are not reachable. No route renders
them and nothing outside their own unit tests imports them. The
``/event-montage`` route redirects to ``/events?view=montage``, which the
``Events`` page serves with the ``EventMontageView`` component; that is a
different file from ``pages/EventMontage.tsx``.

Pages are built from Tailwind classes and the shadcn/ui primitives in
``src/components/ui/`` (``Button``, ``Card``, ``Input``, ``Select``). Most
wrap their content in ``PageContainer``
(``src/components/common/PageContainer.tsx``) for consistent padding. Toasts
come from ``toast`` in ``sonner``.

Dashboard
---------

**Location**: ``src/pages/Dashboard.tsx``

The user sees a header with a refresh button, an Edit toggle, and a config
button that adds widgets. Below it is a grid of widgets: a monitor feed, a
recent-events list, a timeline, or an event heatmap. With Edit on, widgets
can be dragged and resized; with it off they are static. A new profile
starts with no widgets and gets an empty-state prompt instead of a grid.

The page component is thin. It reads edit state and the widget list from
``useDashboardStore`` and renders ``<DashboardLayout />``:

.. code:: tsx

   // src/pages/Dashboard.tsx
   const isEditing = useDashboardStore((state) => state.isEditing);
   const currentProfile = useProfileStore(
       useShallow((state) => {
           const { profiles, currentProfileId } = state;
           return profiles.find((p) => p.id === currentProfileId) || null;
       })
   );
   const profileId = currentProfile?.id || 'default';
   const widgets = useDashboardStore(
       useShallow((state) => state.widgets[profileId] ?? [])
   );

The ``useShallow`` wrappers are not decoration. A Zustand selector re-renders
the component whenever its return value changes identity, and both of these
selectors build a fresh value on every call: ``find()`` produces a result and
``?? []`` produces a new empty array. Without ``useShallow`` the dashboard
would re-render on every unrelated store write. See
:doc:`03-state-management-zustand`.

DashboardLayout: keeping the grid and the store in step
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**Location**: ``src/components/dashboard/DashboardLayout.tsx``

``react-grid-layout`` owns the drag-and-drop grid. It wants the layout as a
prop and reports every change back through ``onLayoutChange``. The widget
positions also live in the Zustand dashboard store so they survive a reload.
Two sources of truth pointed at each other is exactly the shape that loops
forever, and the component spends most of its code not looping.

The store-to-local direction runs in an effect. An effect is a function React
runs after it has painted, re-running whenever one of the values in its
dependency array changed since the last run:

.. code:: tsx

   const isSyncingFromStoreRef = useRef(false);

   useEffect(() => {
       isSyncingFromStoreRef.current = true;
       setLayout((prev) => (areLayoutsEqual(prev, layouts) ? prev : layouts));
       requestAnimationFrame(() => {
           isSyncingFromStoreRef.current = false;
       });
   }, [layouts, areLayoutsEqual]);

``useRef`` returns a mutable box whose ``.current`` survives re-renders and,
unlike state, does not trigger one when written. That property is what makes
it usable as a flag inside a render cycle.

The local-to-store direction is the grid's own callback:

.. code:: tsx

   const handleLayoutChange = useCallback((nextLayout: Layout[]) => {
       setLayout((prev) => (areLayoutsEqual(prev, nextLayout) ? prev : nextLayout));

       if (!isEditing || isSyncingFromStoreRef.current) return;

       updateLayouts(profileIdRef.current, { lg: nextLayout });
   }, [areLayoutsEqual, isEditing]);

Trace the loop the flag prevents. The store's widget layouts change, the
effect copies them into local state, ``react-grid-layout`` re-renders and
calls ``onLayoutChange`` with the layout it was just handed,
``handleLayoutChange`` writes that layout back to the store, and the store's
layouts change again. ``isSyncingFromStoreRef`` makes the write a no-op for
the frames in which the change originated in the store.
``requestAnimationFrame`` clears it once React has painted; the code comment
records that this timed more predictably than ``queueMicrotask``.

Two smaller guards do the rest. ``areLayoutsEqual`` returns the previous
array when nothing moved, so an equal update does not create a new reference
and does not re-render. And ``profileIdRef`` keeps ``profileId`` out of
``handleLayoutChange``'s dependency array: without it the callback would get
a new identity on every profile switch, and ``react-grid-layout`` would see a
changed prop.

The profile id itself is minted, not passed through as a raw string:

.. code:: tsx

   // src/components/dashboard/DashboardLayout.tsx
   const profileId = currentProfile?.id || asProfileId('default');

``'default'`` is a placeholder key for the no-profile-selected case. Widget
storage still needs a key, and ``ProfileId`` is a branded type, so the
placeholder has to be branded explicitly rather than smuggled in. The
Dashboard snippet above writes the same fallback as a bare ``'default'``,
which is not an inconsistency: ``src/pages/Dashboard.tsx`` only indexes
``state.widgets``, a ``Record<string, ...>``, whereas
``src/components/dashboard/DashboardLayout.tsx`` also hands the id to
``DashboardWidget``, whose ``profileId`` prop is typed ``ProfileId``.

Montage
-------

**Location**: ``src/pages/Montage.tsx``

An edge-to-edge grid of every monitor in the current group, each tile a live
feed. A toolbar above it picks the group, the column count, the fit mode, and
toggles fullscreen and edit mode. In edit mode tiles are dragged and resized,
and an arrangement can be saved by name and reloaded later.

The page uses ``react-grid-layout`` with an internal grid sized to
``displayColumns * COL_SUBDIVISION`` units, so N display columns always
render exactly N. Each default tile is one column wide
(``COL_SUBDIVISION`` units) and can be resized down to a single unit. A fixed
12-column grid was used previously, which rendered the wrong count for column
values that do not divide 12 (5 rendered 6, 9 rendered 12); see issue #220.

Layout logic lives in hooks under ``src/components/montage/``:

- **useMontageGrid**: layout state, column math, aspect-ratio-aware height,
  saved-layout persistence, migration from older formats.
- **useContainerResize**: ``ResizeObserver`` wrapper with debounced width
  tracking.
- **useFullscreenMode**: Fullscreen API toggle.

.. code:: tsx

   // src/pages/Montage.tsx, trimmed to the grid path
   import { useMontageGrid, useContainerResize } from '../components/montage';
   import { internalColsForCols } from '../components/montage/hooks/useMontageGrid';

   const { groupKey, bucket } = useMontageGroupState();

   const {
     layout, gridCols, currentWidthRef,
     handleLayoutChange, handleResizeStop, handleWidthChange,
   } = useMontageGrid({ monitors, currentProfile, settings, isEditMode, groupKey });

   const { containerRef } = useContainerResize({
     onWidthChange: handleWidthChange,
     currentWidthRef,
   });

   return (
     <div ref={containerRef}>
       <WrappedGridLayout
         cols={internalColsForCols(gridCols)}   // gridCols * COL_SUBDIVISION
         layout={layout}
         rowHeight={GRID_LAYOUT.montageRowHeight}
         margin={[0, 0]}
         containerPadding={[0, 0]}
         onLayoutChange={handleLayoutChange}
         onResizeStop={handleResizeStop}
       >
         {layout.map(item => (
           <MontageMonitor key={item.i} monitor={/* ... */} />
         ))}
       </WrappedGridLayout>
     </div>
   );

Proportional internal grid
~~~~~~~~~~~~~~~~~~~~~~~~~~

``COL_SUBDIVISION`` is 12 (``MONTAGE_GRID.colSubdivision``), the number of
internal units per display column. ``internalColsForCols(displayCols)``
returns the total grid width, ``displayCols * COL_SUBDIVISION``. Default item
width is one column, so the number of tiles per row equals the display column
count exactly, for every column count. Vertical compaction reflows items
automatically.

Watching the container: ResizeObserver and the callback ref
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Tile heights depend on pixel width, so the grid has to know how wide its
container is. ``useContainerResize``
(``src/components/montage/hooks/useContainerResize.ts``) attaches a
``ResizeObserver``:

.. code:: tsx

   const containerRef = useCallback(
     (element: HTMLDivElement | null) => {
       if (resizeObserverRef.current) {
         resizeObserverRef.current.disconnect();
         resizeObserverRef.current = null;
       }
       if (!element) return;

       const observer = new ResizeObserver((entries) => { /* ... */ });
       observer.observe(element);
       resizeObserverRef.current = observer;
     },
     [onWidthChange, currentWidthRef]
   );

``containerRef`` is a **callback ref**: when you pass a function to a DOM
node's ``ref`` prop, React calls it with the element on mount and with
``null`` on unmount. This is a different feature from the ``useRef`` box
described in :doc:`02-react-fundamentals`, which only holds a value and is
never called. Do not read ``useCallback`` semantics off this example either.
``useCallback`` appears here for one reason: React re-invokes a callback ref
whenever the function's identity changes, so an inline arrow function would
disconnect and rebuild the ``ResizeObserver`` on every single render.

Inside the observer, the first non-zero measurement calls ``onWidthChange``
immediately so the initial layout can be built. Later changes update
``currentWidthRef.current`` right away but debounce the callback by
``GRID_LAYOUT.resizeDebounceMs`` (500 ms), so heights are recomputed once the
user stops dragging the window edge rather than on every intermediate frame.

That callback is where an observer and a store meet, and it is the trap worth
naming. ``useMontageGrid`` mirrors every unstable value it needs into a ref,
updating each one in its own effect:

.. code:: tsx

   // src/components/montage/hooks/useMontageGrid.ts, trimmed
   const currentProfileRef = useRef(currentProfile);
   const settingsRef = useRef(settings);
   const displayColsRef = useRef(bucketGridCols);

   useEffect(() => { currentProfileRef.current = currentProfile; }, [currentProfile]);
   useEffect(() => { settingsRef.current = settings; }, [settings]);
   useEffect(() => { displayColsRef.current = displayCols; }, [displayCols]);

The refs let ``handleWidthChange`` keep an empty dependency array. If
``currentProfile`` and ``settings`` were dependencies instead,
``handleWidthChange`` would take a new identity whenever the settings store
wrote, ``containerRef`` would take a new identity with it, React would
re-invoke the callback ref, the fresh ``ResizeObserver`` would fire
immediately with the current width, and its callback would write settings
again. Reach for this pattern whenever a callback owned by an external
observer (``ResizeObserver``, timers, event listeners) reads store values and
writes back to them.

Aspect-ratio height
~~~~~~~~~~~~~~~~~~~

``calculateHeightUnits`` in ``useMontageGrid.ts`` converts a tile's pixel
width into grid row units, so a 16:9 camera gets a 16:9 tile:

.. code:: typescript

   const columnWidth = (gridWidth - margin * (internalCols - 1)) / internalCols;
   const itemWidth = columnWidth * widthUnits + margin * (widthUnits - 1);
   const videoPx = itemWidth * aspectRatio;
   const heightPx = videoPx + MONTAGE_GRID.cardHeaderHeightPx;   // 32, the h-8 header bar
   const unit = (heightPx + margin) / (GRID_LAYOUT.montageRowHeight + margin);

   return Math.max(2, Math.ceil(unit));

``GRID_LAYOUT.montageRowHeight`` is 1 pixel. A row unit that small is what
lets the arithmetic land on an exact pixel height instead of quantizing to a
row and leaving black bars.

Saved layouts
~~~~~~~~~~~~~

Each saved layout stores the ``Layout[]`` array and the ``displayCols`` in
effect when it was saved. Saved layouts are scoped per monitor group:
``useMontageGroupState()`` (``src/hooks/useMontageGroupState.ts``) resolves the
active ``groupKey`` and hands back that group's ``bucket``.

- **Save**: ``handleSaveLayout(name)`` in ``Montage.tsx`` appends to
  ``bucket.savedLayouts`` through the settings store action
  ``updateMontageGroupLayout(profileId, groupKey, patch)``.
- **Load**: ``handleLoadLayout(saved)`` calls the hook's
  ``handleLoadSavedLayout(layout, displayCols)``.
- **Delete**: ``handleDeleteLayout(index)``.
- **Active name**: ``bucket.activeLayoutName`` tracks the currently loaded
  saved layout, cleared when the user switches to a preset column count.

See :doc:`12-shared-services-and-components` for the group-scoped settings
shape.

Layout migration
~~~~~~~~~~~~~~~~

``isLegacyLayout(stored, displayCols)`` in ``useMontageGrid`` detects layouts
saved on the old fixed 12-column grid. On the proportional grid a layout of
two or more columns has a rightmost edge beyond one ``COL_SUBDIVISION``
block, so a stored layout whose rightmost edge fits inside one block is
legacy. Single-column layouts are left alone, because the legacy and
proportional coordinate spaces coincide there.

Legacy layouts can encode the wrong column count, so the restore effect
rebuilds the default layout for the stored ``gridCols`` and persists it,
replacing the stale coordinates. The column-count setting is kept; a custom
tile arrangement is rebuilt once.

Toolbar toggle
~~~~~~~~~~~~~~

An eye-toggle button shows and hides the toolbar (group filter, grid
controls, fit selector, refresh, edit, fullscreen). Stored per profile in
``settings.montageShowToolbar``. i18n key: ``montage.toggle_toolbar``.

Monitors
--------

**Location**: ``src/pages/Monitors.tsx``

The user sees every enabled monitor for the current profile, as a vertical
list of wide cards or as a column grid, each card showing a live feed and the
event count for the last week. The toolbar carries a group filter, a
list/grid toggle, a column-count control (grid mode only), a Fit/Crop
selector, and refresh. Tapping a card opens ``MonitorDetail``.

.. code:: tsx

   // src/pages/Monitors.tsx, trimmed
   const { data, isLoading, error, refetch } = useQuery({
     queryKey: queryKeys.monitors(currentProfile?.id),
     queryFn: () => getMonitors(),
     enabled: !!currentProfile && isAuthenticated,
     refetchInterval: bandwidth.monitorStatusInterval,
   });

   const { data: eventCounts } = useQuery({
     queryKey: queryKeys.consoleEventsList(currentProfile?.id, '1 week'),
     queryFn: () => getConsoleEvents('1 week'),
     enabled: !!currentProfile && isAuthenticated,
     refetchInterval: bandwidth.consoleEventsInterval,
   });

Query keys always come from the ``queryKeys`` factory in
``src/lib/query/query-keys.ts``, never as an inline array. An inline key
drifts out of step with whatever code invalidates it, and a key without the
profile id leaks one server's cache into another. Refetch intervals always
come from ``useBandwidthSettings()``, never a hardcoded number. See
:doc:`07-api-and-data-fetching`.

Both gates on the render path are worth reading closely:

.. code:: tsx

   if (isLoading || !isFilterReady) {
     return /* skeleton */;
   }

   if (error && !data) {
     return (
       <div className="p-8">
         <h1 className="text-lg font-bold tracking-tight">{t('monitors.title')}</h1>
         <ErrorBanner
           message={resolveQueryError(error, t, { fallbackKey: 'monitors.failed_to_load' })}
         />
       </div>
     );
   }

The first gate waits on ``isFilterReady`` from ``useGroupFilter()`` as well as
the query. A mounted ``MonitorCard`` starts its stream, so rendering every
monitor for a single frame before the group filter narrows the list would
open every camera's stream and then immediately close most of them.

The second gate only walls off a cold start. A background refetch that fails
while cached monitors are on screen falls through to the normal view, where
``AppLayout``'s ``OfflineBanner`` explains the state without throwing the
user's cameras away. ``resolveQueryError`` folds a 401 into the localized
auth prompt and everything else into the fallback key; ``ErrorBanner`` renders
it. Never render ``error.message`` directly.

Column count in grid mode comes from ``useEventMontageGrid``
(``src/hooks/useEventMontageGrid.ts``), shared with the events montage. It
listens on ``window``'s ``resize`` event rather than observing the container,
and clamps the user's choice against what fits:

.. code:: typescript

   // src/lib/event/event-utils.ts
   export const getMaxColsForWidth = (width: number, minWidth: number, gap: number): number => {
     if (width <= 0) return 1;
     const maxCols = Math.floor((width + gap) / (minWidth + gap));
     return Math.max(1, maxCols);
   };

Called with ``EVENT_GRID_CONSTANTS.MIN_CARD_WIDTH`` (50) and
``EVENT_GRID_CONSTANTS.GAP`` (16). Asking for more columns than fit raises a
``eventMontage.screen_too_small`` toast and leaves the count unchanged.

MonitorDetail
-------------

**Location**: ``src/pages/MonitorDetail.tsx``

One monitor, filling the screen, always streaming (the global Snapshot
setting does not apply here). PTZ controls appear if the camera is
controllable, zone overlays if the user asks for them, plus pinch-zoom,
snapshot download, and swipe navigation to the next monitor.

Three queries, each gated on what it needs:

.. code:: tsx

   const { id } = useParams<{ id: string }>();

   const { data: monitor, isLoading, error } = useQuery({
     queryKey: queryKeys.monitor(currentProfile?.id, id),
     queryFn: () => getMonitor(id!),
     enabled: !!id,
   });

   const { data: controlData } = useQuery({
     queryKey: queryKeys.control(currentProfile?.id, monitor?.Monitor.ControlId),
     queryFn: () => getControl(monitor!.Monitor.ControlId!),
     enabled: !!monitor?.Monitor.ControlId && monitor.Monitor.Controllable === '1',
   });

   const { data: zones = [] } = useQuery({
     queryKey: queryKeys.zones(currentProfile?.id, id),
     queryFn: () => getZones(id!),
     enabled: !!id && showZones,
   });

``enabled: false`` keeps a query from running at all, which is how the
control query avoids asking ZoneMinder about PTZ for a camera that has none,
and how the zones query stays idle until the user turns the overlay on. The
non-null assertions inside each ``queryFn`` are safe precisely because the
matching ``enabled`` condition already proved the value exists.

Loading and error states use the shared pieces: ``DetailPageSkeleton`` and
``ErrorBanner``, both from ``src/components/ui/query-state.tsx``.

Stream URLs are built by helpers in ``src/lib/zm/url-builder.ts``
(``getMonitorStreamUrl``, ``getMonitorControlUrl``, ``getEventZmsUrl``,
``getEventVideoUrl``, ``getGo2RTCWebSocketUrl``, and others). They handle
``connkey`` generation, token attachment, and protocol selection. Never
hand-build a ZoneMinder stream URL in a page or component.

Event thumbnails go through ``src/lib/event/thumbnail-chain.ts``, which
chooses among ``zms``, cached, or API sources. Non-stream HTTP traffic uses
``httpGet`` / ``httpPost`` / ``httpPut`` / ``httpDelete`` from
``src/lib/http.ts``, never raw ``fetch()`` or ``axios``.

Events
------

**Location**: ``src/pages/Events.tsx``

Recorded events, newest first, as a list of rows with thumbnails or as a
montage of thumbnail tiles. Above them sit a heatmap, quick date-range
buttons, a group filter, and a filter popover for monitors, tags, dates,
favorites, archived, and detected-objects-only. The bottom of the list has a
Load More button.

.. code:: tsx

   // src/pages/Events.tsx, trimmed
   const { eventLimit, batchSize, isLoadingMore, loadNextPage } = useEventPagination({
     defaultLimit: settings.defaultEventLimit || 100,
     persistKey: paginationKey,
   });

   const { data: eventsData, isLoading, isFetching, error, refetch } = useQuery({
     queryKey: queryKeys.eventsList(
       currentProfile?.id, filters, eventLimit, effectiveMonitorId,
       isGroupFilterActive, eventIdFilter, tagIdFilter,
     ),
     queryFn: () => getEvents({ /* ...filters, limit: eventLimit */ }),
     enabled: !!currentProfile && isAuthenticated,
     placeholderData: keepPreviousData,
   });

This is a plain ``useQuery``, not ``useInfiniteQuery``. Pagination is a
growing ``limit``: Load More adds ``batchSize`` to ``eventLimit``, which
changes the query key, which fetches a longer list from the top.
``placeholderData: keepPreviousData`` keeps the old list on screen while the
longer one is in flight, so the page does not blank out and scroll to the top
between pages.

``useEventPagination`` takes a ``persistKey`` built from the query key with
the limit zeroed out. Opening an event unmounts the Events page, so a
component-local count would collapse back to the first page on the way back
(refs #197). The key identifies the result set, so changing a filter still
resets to page one.

Filter state lives in ``useEventFilters()`` (``src/hooks/useEventFilters.ts``),
which returns both the filter values and their setters. Rendering is
``EventListView`` or ``EventMontageView`` from ``src/components/events/``.

``EventListView`` maps over the events and renders them all. It is
deliberately not virtualized. Virtualization with ``@tanstack/react-virtual``
was attempted twice and produced blank rows and stale text in the recycled
row components both times. Do not re-attempt it without a plan for those two
failures.

ProfileForm
-----------

**Location**: ``src/pages/ProfileForm.tsx``

Creates a ZoneMinder server profile: name, portal URL, credentials, optional
manual API/CGI URLs, optional go2rtc URL, and self-signed certificate trust.
A QR scanner can fill the fields from another device. The first profile the
app has ever seen is pre-filled with the ZoneMinder demo server.

This page only creates. It has no ``:id`` parameter and no update path.
Editing an existing profile happens in a dialog on ``Profiles.tsx``, which
calls ``updateProfile`` from the profile store. ``ProfileForm`` reads
``useSearchParams`` rather than ``useParams``, and uses it for one thing:

.. code:: tsx

   const [searchParams] = useSearchParams();
   const returnTo = searchParams.get('returnTo') || '/monitors';

Testing the connection is a separate action from saving.
``handleTestConnection`` runs discovery against the portal URL behind an
``AbortController``, applies the self-signed-certificate trust setting before
any network call, and reports through ``toast``. Only after that does
``addProfile`` run, which is ``async`` and returns the new profile's id, so
that per-profile settings (the accepted certificate fingerprint, for one)
can be written against it before ``navigate(returnTo)``.

Secondary views
---------------

**Logs** (``src/pages/Logs.tsx``) shows zmNinjaNg's own in-memory logs or the
ZoneMinder server's, switched by a ``LogSource`` of ``'zmng' | 'server'``, and
filtered by level and component. Both can be exported or shared to a file.

**NotificationSettings** (``src/pages/NotificationSettings.tsx``) configures
push: Event Server mode over a WebSocket, or Direct mode polling the ZM
Notifications API, plus per-monitor filters.
**NotificationHistory** (``src/pages/NotificationHistory.tsx``) lists past
notifications with read status and thumbnails, and navigates to the event on
tap.

**Server** (``src/pages/Server.tsx``) reports every server in the cluster:
version, load, storage areas, daemon status, and the ZM run-state controls.

**Profiles** (``src/pages/Profiles.tsx``) switches, edits, and deletes server
profiles.

**Settings** (``src/pages/Settings.tsx``) is three flat sections (Appearance,
Streaming and Playback, Advanced) delegating to components under
``src/components/settings/``. Every write goes through
``updateProfileSettings(currentProfile.id, patch)``.

**DeveloperNotice** (``src/pages/DeveloperNotice.tsx``) lists notices fetched
from a feed, unread first.

Timeline
--------

**Location**: ``src/pages/Timeline.tsx``

Events drawn on a hand-rolled HTML5 ``<canvas>`` (``TimelineCanvas.tsx``).
Rows group by monitor and take their color from ``getMonitorColor(rowIdx)``
in ``timeline-layout.ts``, so the color tracks a monitor's row position, not
its id. Zoom, pan, quick-range buttons, and an interactive scrubber sit on
top. The renderer
(``timeline-renderer.ts``), viewport (``useTimelineViewport.ts``), gestures
(``useTimelineGestures.ts``), and hit-testing (``timeline-hit-test.ts``) are
separate modules so each can be tested without a canvas.

The page itself is composition. ``src/hooks/useTimelineData.ts`` owns the
events query (with per-monitor fan-out when a cause filter is active), the
live-mode notification subscription that injects synthetic events, and the
debounced refetch that follows one (``TIMELINE.liveRefetchDebounceMs``,
2000 ms, long enough for ZoneMinder to index the event). Detection category
state and filtering live in
``src/components/timeline/useDetectionCategories.ts``. The filter card
(``TimelineFiltersPanel.tsx``), control row (``TimelineToolbar.tsx``), and
statistics row (``TimelineStats.tsx``) are separate components.

Toolbar buttons and TV d-pad commands reach the canvas through a single
``ViewportAction`` prop shaped ``{ type, seq }``. The canvas runs the named
action (reset, zoomIn, zoomOut, goToNow, panLeft, panRight, followNow) once
per ``seq`` change. Passing the action as a plain prop rather than calling a
method on the canvas keeps the parent free of a ref into the child, and the
counter is what makes two identical actions in a row distinguishable.

Common page patterns
--------------------

Profile requirement
~~~~~~~~~~~~~~~~~~~

Most pages need a selected profile. Read it through ``useCurrentProfile()``
(``src/hooks/useCurrentProfile.ts``), which returns
``{ currentProfile, settings, hasProfile }``. The Zustand store holds only
``currentProfileId: string | null`` plus the profile list; there is no
``currentProfile`` field on the store to select.

.. code:: tsx

   const { currentProfile, settings } = useCurrentProfile();

If you only need the id, select it directly rather than deriving the whole
profile:

.. code:: tsx

   const currentProfileId = useProfileStore((state) => state.currentProfileId);

Data fetching
~~~~~~~~~~~~~

.. code:: tsx

   const { data, isLoading, error } = useQuery({
     queryKey: queryKeys.monitors(currentProfile?.id),
     queryFn: () => getMonitors(),
     enabled: !!currentProfile && isAuthenticated,
     refetchInterval: bandwidth.monitorStatusInterval,
   });

Loading and error states
~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: tsx

   if (isLoading) return <DetailPageSkeleton />;
   if (error && !data) return <ErrorBanner message={resolveQueryError(error, t)} />;
   if (!data) return <EmptyState icon={Video} title={t('monitors.no_cameras')} />;
   return <Content data={data} />;

``DetailPageSkeleton`` and ``ErrorBanner`` come from
``src/components/ui/query-state.tsx``, ``EmptyState`` from
``src/components/ui/empty-state.tsx``. The ``&& !data`` on the error branch is
the pattern from Monitors and Events: a failed background refetch should not
discard data the user is already looking at.

Navigation
~~~~~~~~~~

.. code:: tsx

   const navigate = useNavigate();
   navigate(`/monitors/${monitorId}`);
   navigate('/profiles', { replace: true });
   navigate(-1);
