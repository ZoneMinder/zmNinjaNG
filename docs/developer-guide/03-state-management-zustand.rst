State Management with Zustand
=============================

zmNinjaNg uses `Zustand <https://github.com/pmndrs/zustand>`_ for global
state. This chapter covers how stores are structured, how components
subscribe, and the reference-equality pitfalls that caused us trouble.

Why Global State
----------------

``useState`` is fine for component-local state, but profile, auth,
settings, and notifications need to be visible to many components across
the tree. Without a shared store, you end up prop-drilling. Zustand gives
you a global ``useState``-like hook any component can call, with no Context
Provider, optional persistence middleware, and access from outside React
via ``store.getState()``.

Creating a Store
----------------

``create`` takes a function that receives ``set`` (and optionally ``get``)
and returns the store's initial state plus the actions that change it.
Actions live next to the data they touch:

.. code:: tsx

   // src/stores/deleteSelection.ts
   import { create } from 'zustand';

   interface DeleteSelectionState {
     selectedIds: string[];
     toggle: (eventId: string) => void;
     clear: () => void;
   }

   export const useDeleteSelectionStore = create<DeleteSelectionState>((set) => ({
     selectedIds: [],
     toggle: (eventId) =>
       set((s) => ({
         selectedIds: s.selectedIds.includes(eventId)
           ? s.selectedIds.filter((id) => id !== eventId)
           : [...s.selectedIds, eventId],
       })),
     clear: () => set({ selectedIds: [] }),
   }));

That is the whole store. ``useDeleteSelectionStore`` is both a React hook
and an object with ``.getState()`` / ``.setState()`` on it, which is what
makes the same store usable from non-React code later in this chapter.

The ``set`` Function
~~~~~~~~~~~~~~~~~~~~

``set`` takes either an object, which merges into state, or a function
receiving the current state. Both forms must return *new* objects and
arrays rather than mutating the existing ones:

.. code:: tsx

   set({ selectedIds: [] })                                        // object form
   set((state) => ({ selectedIds: [...state.selectedIds, id] }))   // function form

   // Wrong: subscribers compare old and new by reference, see the same
   // array, and skip the re-render. The UI never updates.
   set((state) => { state.selectedIds.push(id); return state; })

This is the Stores contract in ``AGENTS.project.md``: never mutate an object you obtained from
the store, including one you read through ``getState()``.

Initialize every field. ``items: undefined`` looks harmless until an action
spreads it (``[...state.items, item]``) and crashes. Arrays start as ``[]``,
counters as ``0``, nullable references as ``null``.

Reading State in Components
---------------------------

A component subscribes by calling the store hook with a *selector*, a
function that picks one field out of the state. Zustand re-runs the
selector whenever any part of the store changes and re-renders the
component only when the selector's result changes. ``App`` re-renders when
``isInitialized`` flips and ignores every profile add, rename, and switch:

.. code:: tsx

   // src/App.tsx:82, 189
   const isInitialized = useProfileStore((state) => state.isInitialized);

   if (!isInitialized) {
     return <RouteLoadingFallback />;
   }

Selecting an action works the same way. Actions are created once when the
store is created and never replaced, so their reference is already stable:

.. code:: tsx

   // src/components/events/EventCard.tsx:54
   const toggleFavorite = useEventFavoritesStore((state) => state.toggleFavorite);

Computed selectors are fine as long as the result is a primitive. Zustand
compares the previous and next result with ``Object.is``, and two equal
booleans stay equal no matter how many times you recompute them:

.. code:: tsx

   // src/components/events/EventCard.tsx:58
   const isFav = useEventFavoritesStore((state) =>
     currentProfile ? state.isFavorited(currentProfile.id, event.Id) : false
   );

``useShallow``: Stable Array and Object Selections
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The moment a selector *builds* an array or object rather than returning one
that already lives in the store, ``Object.is`` fails. Each call produces a
fresh reference, so Zustand concludes the value changed, re-renders, re-runs
the selector, builds another fresh reference, and loops.

``useShallow`` wraps a selector and compares the result one level deep (each
array element, each object key). If the contents match, it hands back the
*previous* reference and no re-render happens. ``DashboardLayout`` needs it
because of the ``?? []`` fallback:

.. code:: tsx

   // src/components/dashboard/DashboardLayout.tsx:45
   import { useShallow } from 'zustand/react/shallow';

   const widgets = useDashboardStore(
     useShallow((state) => state.widgets[profileId] ?? [])
   );

A profile with no widgets has no ``widgets[profileId]`` entry, so ``?? []``
mints a brand new empty array on every selector run. Without ``useShallow``
that empty dashboard would render forever. With it, every ``[]`` compares
equal to the last ``[]`` and the component settles.

``profile-switcher.tsx:36`` reaches for ``useShallow`` for a different
reason. Its selector returns ``profiles.find((p) => p.id ===
currentProfileId) || null``, an object that already lives in the store, so
the selector mints nothing fresh. What shallow comparison buys there is the
field-by-field check on that profile: ``setDefaultProfile`` rebuilds every
element of ``profiles`` with a spread, and without ``useShallow`` the
switcher would re-render even though none of its profile's fields changed.

Use ``useShallow`` when the selector returns an array, an object literal, or
any derived collection. Skip it for primitives and for single actions, which
are already reference-stable. This is the object-identity lesson from
:doc:`02-react-fundamentals`, now at store scope: React and Zustand both
decide "did this change?" by reference, and a freshly-built value is always
a new reference.

Anti-Pattern: Subscribing to the Whole Store
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Calling the hook with no selector subscribes to everything:

.. code:: tsx

   // Anti-pattern (Stores contract). Re-renders on every store change,
   // including fields this component never reads.
   const { isFavorited, toggleFavorite } = useEventFavoritesStore();

Any write anywhere in the store, to any profile's favorites, re-renders this
component. The Stores contract in ``AGENTS.md`` bans the form. Three call sites predate
the rule and are tracked in issue #230; do not add more.

The mirror-image mistake is over-narrowing. Shrink a selector down to just
the actions and the component reads its data once, on the first render, and
never again: actions never change, so nothing is left to trigger an update.

.. code:: tsx

   // Compiles. Renders once. Then goes stale.
   const toggleFavorite = useEventFavoritesStore((s) => s.toggleFavorite);
   const favorites = useEventFavoritesStore.getState().getFavorites(profileId);

The Stores contract covers both directions: every field the component reads reactively
must be in the selector.

Store Values as Effect Dependencies
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Derived values inherit the same problem. ``currentProfile`` is produced by
``profiles.find((p) => p.id === currentProfileId)``, so it is a lookup, not a
stored field. Anything that replaces the profile object (a ``lastUsed``
timestamp write, for example) hands you a new reference for an unchanged
profile, and an effect keyed on it re-runs. Depend on the primitive id
instead; it only changes when the user really switched profiles:

.. code:: tsx

   const { currentProfile } = useCurrentProfile();
   const profileId = useProfileStore((state) => state.currentProfileId);

   // Wrong: fires more often than the profile actually changes
   useEffect(() => { /* ... */ }, [currentProfile]);

   // Right: a primitive, stable until the id itself changes
   useEffect(() => { /* ... */ }, [profileId]);

``hooks/useCurrentProfile.ts`` already does this work for you. It selects
``currentProfileId`` as a bare primitive, wraps the ``profiles`` array in
``useShallow``, and derives ``currentProfile`` inside a ``useMemo`` so the
object identity only changes when one of those two inputs does. Prefer it
over hand-rolling the lookup.

Actions
-------

Actions encapsulate multi-field updates so callers cannot leave the store in
a half-updated state. Where an action needs to read current state without
subscribing, ``get`` (the second argument to ``create``) returns it;
``profileExists`` in ``stores/profile.ts:84`` is the smallest example.

.. code:: tsx

   // Simplified from src/stores/profile.ts (deleteProfile), secure-storage
   // cleanup and API client re-init omitted
   deleteProfile: async (id) => {
     set((state) => {
       const profiles = state.profiles.filter((p) => p.id !== id);
       const currentProfileId =
         state.currentProfileId === id
           ? (profiles.length > 0 ? profiles[0].id : null)
           : state.currentProfileId;

       return { profiles, currentProfileId };
     });
   },

Deleting the active profile has to pick a new ``currentProfileId`` in the
same ``set`` call. Split across two writes, subscribers would observe a
render where ``currentProfileId`` points at a profile that no longer exists.

Persistence
-----------

The ``persist`` middleware writes state to ``localStorage`` after every
change and reads it back at startup. zmNinjaNg runs on web, Electron, and
Capacitor, all of which expose ``localStorage``, so no custom storage
adapter is needed. Persist keys are never string literals at the call site.
They live in ``STORAGE_KEYS`` in ``lib/zmninja-ng-constants.ts`` (the Constants contract),
because the values are on-disk keys: changing one orphans every existing
user's stored state.

.. code:: tsx

   // src/stores/eventFavorites.ts
   import { persist } from 'zustand/middleware';
   import { STORAGE_KEYS } from '../lib/zmninja-ng-constants';

   export const useEventFavoritesStore = create<EventFavoritesState>()(
     persist(
       (set, get) => ({ /* state and actions */ }),
       { name: STORAGE_KEYS.eventFavoritesStore }
     )
   );

Passwords and tokens are **not** persisted this way. Profile passwords go
through ``lib/security/secureStorage.ts``, which wraps
``@aparajita/capacitor-secure-storage`` (Keychain on iOS, Keystore on
Android, encrypted ``localStorage`` on web). The persisted profile keeps the
sentinel string ``'stored-securely'`` where the password would be, and
``getDecryptedPassword`` fetches the real value on demand.

``localStorage`` is synchronous and capped near 5 MB, so keep persisted state
small. Versioning is manual: detect format changes yourself rather than
assuming stored data matches the current interface.

Hydration
~~~~~~~~~

Rehydration is asynchronous. The store is constructed with its initial state,
the app renders once against those defaults, and persisted state replaces
them a few milliseconds later. A component that reads ``profiles`` during
that window sees an empty array, not the user's servers.
``onRehydrateStorage`` returns a callback that fires once loading finishes.
``stores/profile.ts`` uses it to re-initialize the API client, re-authenticate,
and set ``isInitialized``:

.. code:: tsx

   // Simplified from src/stores/profile.ts:437 (log message shortened here)
   persist(
     (set, get) => ({ /* ... */ }),
     {
       name: STORAGE_KEYS.profilesStore,
       onRehydrateStorage: () => async (state) => {
         try {
           await handleProfileRehydration(state, storeSet, storeGet);
         } catch (error) {
           log.profileService(
             'Unexpected error in onRehydrateStorage - forcing initialization',
             LogLevel.ERROR,
             { error }
           );
           storeSet?.({ isInitialized: true, isBootstrapping: false, bootstrapStep: null });
         }
       },
     }
   )

The ``catch`` forces ``isInitialized`` to ``true``. Left unset, ``App``'s
``if (!isInitialized)`` gate would hold the loading fallback on screen
forever, so a rehydration bug would present as a permanently hung splash.
Note the logging goes through ``log.profileService``, not ``console.error``;
the Logging contract routes every log line through ``lib/logger.ts`` so it lands in the
in-app log viewer.

Calling Stores Outside React
----------------------------

``useProfileStore`` is a hook, but ``useProfileStore.getState()`` is a plain
function call that reads current state from anywhere: services, API clients,
event handlers. There is no subscription and no re-render; you get a
snapshot of the values as of that instant.

Which module performs that call matters. ``stores/notifications.ts:24``
statically imports ``services/pushNotifications.ts`` for exactly one reason:
to call ``setPushServiceStoreGates`` at module load and hand the service the
state accessors it needs. When the store later wants a runtime function out of
that service it uses a dynamic ``import()`` instead (``notifications.ts:630``).
In the return direction the service imports only *types* from the store,
``NotificationSettings`` and ``NotificationSource`` at
``pushNotifications.ts:14``. TypeScript erases a type-only import at compile
time, so it is not a module edge at runtime and ``madge`` does not see it. A
*value* import there would close the cycle, and that is the static
service-to-store edge the Service boundary contract forbids. The inversion is a gate: the service
declares the shape of the state it needs and exposes a registration function,
and the store fills it in at module load.

.. code:: tsx

   // src/services/pushNotifications.ts:52, the service declares what it needs
   let storeGates: PushServiceStoreGates | null = null;

   export function setPushServiceStoreGates(gates: PushServiceStoreGates): void {
     storeGates = gates;
   }

   // src/stores/notifications.ts:717, the store supplies it, using getState
   setPushServiceStoreGates({
     notifications: {
       getCurrentProfileId: () => useNotificationStore.getState().currentProfileId,
       isConnected: () => useNotificationStore.getState().isConnected,
       // ...
     },
     auth: {
       getAccessToken: () => useAuthStore.getState().accessToken,
     },
   });

``api/store-gates.ts`` does the same for the API client, which needs the
access token and the per-profile request timeout without importing either
store. Keep ``npx madge --circular`` at zero.

An End-to-End Switch
~~~~~~~~~~~~~~~~~~~~

The two halves, subscription and ``getState``, meet when the user picks a
different server. Tapping an entry in ``components/profile-switcher.tsx``
calls the ``switchProfile`` action it selected from the store. The action
tears down the outgoing profile (quit active streams, ``logout()``,
``clearQueryCache()``, ``resetApiClient()``), then does the single write that
matters, ``set({ currentProfileId: profile.id })``. Every component holding
a ``currentProfileId`` selector re-renders against the new id, while the
action continues outside React and calls ``setApiClient`` with a client built
for the new server's URL.

Stores in zmNinjaNg
-------------------

::

   src/stores/
   ├── auth.ts                # Access/refresh tokens, login, logout, token refresh
   ├── backgroundTasks.ts     # Long-running downloads and their drawer state
   ├── commandPalette.ts      # Whether the command palette is open
   ├── dashboard.ts           # Per-profile dashboard widgets and grid layouts
   ├── deleteSelection.ts     # Events ticked for bulk delete
   ├── developerNotices.ts    # Read/dismissed/deleted ids for broadcast notices
   ├── eventFavorites.ts      # Per-profile favorited event IDs
   ├── eventPagination.ts     # Remembered "Load More" count, keyed by filter signature
   ├── kioskStore.ts          # Kiosk lock state, PIN attempts, cooldown
   ├── logs.ts                # In-memory ring of recent log entries
   ├── monitors.ts            # Per-monitor ZoneMinder stream connection keys
   ├── notifications.ts       # Push/event-poll config, connection state, alarm events
   ├── profile.ts             # ZoneMinder server profiles and the active one
   ├── query-cache.ts         # Not a store: global QueryClient handle for cache clearing
   ├── returnHighlight.ts     # Last event opened, so the list can flag that row
   └── settings.ts            # App-wide and per-profile settings

Stores are split by domain so components subscribe only to what they need.
Two things that look like stores are not: ``services/profile-bootstrap.ts``
and ``services/profile-initialization.ts`` hold the login/timezone/rehydration
logic that ``profile.ts`` calls, and live under ``services/`` for that reason.

Three of these come up often enough to be worth a sentence each. Deep
reference lives in :doc:`12-shared-services-and-components`.

**Kiosk** (``stores/kioskStore.ts``) holds lock state, the insomnia setting
captured at lock time so unlocking can restore it, and the PIN cooldown.
After ``KIOSK.maxPinAttempts`` (5) failures, ``recordFailedAttempt`` sets
``cooldownUntil`` to ``KIOSK.cooldownMs`` (30 seconds) in the future. Nothing
is persisted, so the app always starts unlocked. The PIN itself lives in
``lib/kioskPin.ts``, in secure storage.

**Background tasks** (``stores/backgroundTasks.ts``) tracks downloads and
exports for the current session. ``addTask`` returns an id you then feed to
``updateProgress``, ``completeTask``, or ``failTask``; ``cancelTask`` invokes
the ``cancelFn`` you registered, which is how a download's ``AbortController``
gets fired from the task drawer. ``activeTasks()`` and ``hasActiveTasks()``
are functions, not fields, so they must be called.

**Event favorites** (``stores/eventFavorites.ts``) maps profile id to an
array of event ids and is persisted. Scoping by profile is what stops a
favorite on one ZoneMinder server from showing up as a starred event on
another.

Reference Equality and Infinite Loops
-------------------------------------

Every trap in this chapter is the same trap. Zustand decides whether to
re-render by comparing references. React decides whether to re-run an effect
or rebuild a ``useCallback`` by comparing references. Hand either of them a
value that is rebuilt on each pass and you get a cycle that never settles.

``DashboardLayout`` sits in the worst version of this. The store owns the
widget layouts; the grid owns a local copy in ``useState`` so dragging feels
immediate; and ``react-grid-layout`` fires ``onLayoutChange`` whenever that
local copy moves. Writing every fired layout back to the store would mean:
store changes, effect copies it into local state, local state change fires
``onLayoutChange``, which writes to the store again.

Two refs break it. A ref is a mutable box whose ``.current`` you can read and
write without triggering a render, which makes it the escape hatch for values
you need to *read* but do not want to *react* to:

.. code:: tsx

   // src/components/dashboard/DashboardLayout.tsx:55
   const profileIdRef = useRef(profileId);
   const isSyncingFromStoreRef = useRef(false);

   useEffect(() => {
     profileIdRef.current = profileId;
   }, [profileId]);

   useEffect(() => {
     isSyncingFromStoreRef.current = true;
     setLayout((prev) => (areLayoutsEqual(prev, layouts) ? prev : layouts));
     requestAnimationFrame(() => {
       isSyncingFromStoreRef.current = false;
     });
   }, [layouts, areLayoutsEqual]);

   const handleLayoutChange = useCallback((nextLayout: Layout[]) => {
     setLayout((prev) => (areLayoutsEqual(prev, nextLayout) ? prev : nextLayout));
     if (!isEditing || isSyncingFromStoreRef.current) return;
     updateLayouts(profileIdRef.current, { lg: nextLayout });
   }, [areLayoutsEqual, isEditing]);

``isSyncingFromStoreRef`` marks the store-to-local direction so the
resulting ``onLayoutChange`` is ignored rather than echoed back.
``profileIdRef`` keeps ``profileId`` out of ``handleLayoutChange``'s
dependency array, so the callback identity survives a profile change instead
of being rebuilt and handed to ``react-grid-layout`` as a new prop.

Notice the third defense, and the one to reach for first: ``areLayoutsEqual``
compares layouts field by field, and ``setLayout((prev) => equal ? prev :
next)`` returns the *previous* array when nothing moved. React bails out of a
re-render when ``useState`` is set to the identical reference. Structural
comparison plus returning the old reference is exactly what ``useShallow``
does for selectors, applied here at component scope.

Reach for refs only after the cheaper move fails: select a primitive.
``currentProfileId`` is a string, ``isEditing`` is a boolean, and neither can
ever be a stale reference.
