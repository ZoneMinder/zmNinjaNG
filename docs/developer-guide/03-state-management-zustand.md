# State Management with Zustand

This chapter explains how zmNg manages global application state using Zustand.

## Why Do We Need Global State Management?

React's `useState` works great for component-local state, but applications need to share state across many components:

```
ProfileSettings (needs: currentProfile)
   ├── MonitorList (needs: currentProfile)
   │      └── MonitorCard (needs: currentProfile)
   └── DashboardConfig (needs: currentProfile)
```

Without global state, you'd have to:
1. Store state in a common parent component
2. Pass it down through every intermediate component ("prop drilling")
3. Pass callback functions back up to update it

This becomes unmaintainable quickly.

## What is Zustand?

Zustand is a lightweight state management library. Think of it as a global `useState` that any component can access.

**Key features**:
- Simple API (less boilerplate than Redux)
- No Context Provider needed
- TypeScript-friendly
- Works outside React components
- Automatic persistence to storage

## Creating a Store

A store is created using the `create` function:

```tsx
// src/stores/useProfileStore.ts
import { create } from 'zustand';

interface ProfileState {
  // State
  currentProfile: Profile | null;
  profiles: Profile[];

  // Actions (functions that modify state)
  setCurrentProfile: (profile: Profile | null) => void;
  addProfile: (profile: Profile) => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  // Initial state
  currentProfile: null,
  profiles: [],

  // Actions
  setCurrentProfile: (profile) =>
    set({ currentProfile: profile }),

  addProfile: (profile) =>
    set((state) => ({
      profiles: [...state.profiles, profile]
    })),
}));
```

### The `set` Function

`set` is how you update the store. It has two forms:

**Object form** (merge state):
```tsx
set({ currentProfile: profile })  // Merges { currentProfile: profile } into state
```

**Function form** (access current state):
```tsx
set((state) => ({
  profiles: [...state.profiles, newProfile]
}))
```

**Important**: Like React state, you must return a **new object/array**, not mutate:

```tsx
// ❌ Wrong - mutates state
set((state) => {
  state.profiles.push(newProfile);
  return state;
})

// ✅ Correct - creates new array
set((state) => ({
  profiles: [...state.profiles, newProfile]
}))
```

## Using a Store in Components

Import the hook and call it to get state and actions:

```tsx
import { useProfileStore } from '../stores/useProfileStore';

function ProfileSelector() {
  // Get everything
  const { currentProfile, profiles, setCurrentProfile } = useProfileStore();

  return (
    <View>
      {profiles.map(profile => (
        <Pressable
          key={profile.id}
          onPress={() => setCurrentProfile(profile)}
        >
          <Text>{profile.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}
```

### Selectors: Optimizing Re-renders

**Important**: When you call `useProfileStore()` without arguments, the component re-renders whenever **any** state in the store changes, even if you don't use it.

```tsx
function UserName() {
  const { currentProfile } = useProfileStore();
  // ⚠️ This re-renders when profiles array changes, even though we don't use it!

  return <Text>{currentProfile?.name}</Text>;
}
```

**Selectors** let you subscribe to specific parts of state:

```tsx
function UserName() {
  // Only re-renders when currentProfile changes
  const currentProfile = useProfileStore((state) => state.currentProfile);

  return <Text>{currentProfile?.name}</Text>;
}
```

**When to use selectors**:
- When you only need a small part of the store
- In frequently-rendered components
- To prevent unnecessary re-renders

**When NOT to use selectors**:
- When you need multiple pieces of state (use destructuring instead)
- In components that rarely render

### Multiple Selectors

```tsx
function ProfileView() {
  const currentProfile = useProfileStore((state) => state.currentProfile);
  const setCurrentProfile = useProfileStore((state) => state.setCurrentProfile);
  // Each selector is independent - component re-renders only when these specific values change
}
```

### Computed Values in Selectors

Selectors can derive data:

```tsx
function ActiveMonitorsCount() {
  const activeCount = useMonitorStore((state) =>
    state.monitors.filter(m => !m.deleted).length
  );

  return <Text>Active: {activeCount}</Text>;
}
```

**Performance caveat**: This creates a new number on every store update. For complex derivations, use `useMemo`:

```tsx
function MonitorList() {
  const monitors = useMonitorStore((state) => state.monitors);

  const activeMonitors = useMemo(
    () => monitors.filter(m => !m.deleted),
    [monitors]
  );

  // ...
}
```

## Store Actions: Best Practices

Actions should encapsulate business logic:

```tsx
export const useProfileStore = create<ProfileState>((set, get) => ({
  currentProfile: null,
  profiles: [],

  // Simple action
  setCurrentProfile: (profile) =>
    set({ currentProfile: profile }),

  // Complex action with logic
  deleteProfile: (profileId) => {
    const { profiles, currentProfile, setCurrentProfile } = get();

    // Remove profile
    const newProfiles = profiles.filter(p => p.id !== profileId);

    // If we deleted the current profile, select another
    if (currentProfile?.id === profileId) {
      setCurrentProfile(newProfiles[0] || null);
    }

    set({ profiles: newProfiles });
  },
}));
```

**The `get` function**: Second parameter to `create`, returns current state:

```tsx
create<State>((set, get) => ({
  count: 0,
  increment: () => {
    const current = get().count;  // Access current state
    set({ count: current + 1 });
  }
}))
```

## Persistence

Zustand can persist state to storage automatically:

```tsx
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      // State and actions here
    }),
    {
      name: 'profile-storage',  // Storage key
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
```

**How it works**:
1. When state changes, Zustand saves it to AsyncStorage
2. On app launch, Zustand loads state from AsyncStorage
3. Everything is automatic

**Caveats**:
- Only serializable data (no functions, dates need special handling)
- Can slow down updates if state is large
- Versioning is manual (detect and handle format changes yourself)

## Calling Stores Outside React

Unlike React state, Zustand works outside components:

```tsx
import { useProfileStore } from '../stores/useProfileStore';

// In a regular function (not a component)
export function getCurrentProfile(): Profile | null {
  return useProfileStore.getState().currentProfile;
}

// Update from outside React
export function resetProfile(): void {
  useProfileStore.getState().setCurrentProfile(null);
}
```

This is useful for:
- Utility functions
- API clients
- Event handlers outside React

## The Critical Issue: Object References

**This is the source of our infinite loop bugs (detailed in Chapter 4).**

Zustand stores return **new object references** on every access, even if the values haven't changed:

```tsx
function MyComponent() {
  const settings = useProfileStore((state) => state.settings);

  useEffect(() => {
    console.log('Settings changed!');
  }, [settings]);  // ⚠️ Runs on EVERY render!
}
```

**Why?** Even though `settings` value might be identical, Zustand can't guarantee it's the same reference.

**This causes infinite loops when**:
1. You use a Zustand value as a dependency in `useCallback` or `useEffect`
2. That callback/effect updates state
3. State update triggers re-render
4. Re-render creates new Zustand reference
5. New reference triggers callback/effect again
6. → Infinite loop

### Example: The Infinite Loop

```tsx
function DashboardLayout() {
  const currentProfile = useProfileStore((state) => state.currentProfile);
  const updateSettings = useProfileStore((state) => state.updateSettings);

  // ⚠️ INFINITE LOOP!
  const handleResize = useCallback((width: number) => {
    if (currentProfile) {
      updateSettings(currentProfile.id, { layoutWidth: width });
    }
  }, [currentProfile, updateSettings]);  // These change on every render!

  // handleResize changes → triggers ResizeObserver → updates settings
  // → triggers re-render → currentProfile/updateSettings get new references
  // → handleResize changes again → infinite loop
}
```

### The Solution: Refs (Preview)

We solve this using `useRef` to hold Zustand values without making them dependencies:

```tsx
function DashboardLayout() {
  const currentProfile = useProfileStore((state) => state.currentProfile);
  const updateSettings = useProfileStore((state) => state.updateSettings);

  // Store in refs
  const currentProfileRef = useRef(currentProfile);
  const updateSettingsRef = useRef(updateSettings);

  // Keep refs updated
  useEffect(() => {
    currentProfileRef.current = currentProfile;
    updateSettingsRef.current = updateSettings;
  }, [currentProfile, updateSettings]);

  // ✅ Now stable - no Zustand values as dependencies
  const handleResize = useCallback((width: number) => {
    if (currentProfileRef.current) {
      updateSettingsRef.current(currentProfileRef.current.id, { layoutWidth: width });
    }
  }, []);  // Empty dependencies - never recreates

  // handleResize is stable → no infinite loop
}
```

See Chapter 4 for detailed analysis of this pattern.

## Zustand Store Structure in zmNg

We use multiple stores for different domains:

```
src/stores/
├── useProfileStore.ts       # User profiles management
├── useAuthStore.ts          # Authentication tokens and state
├── useSettingsStore.ts      # Application and profile settings
├── useDashboardStore.ts     # Dashboard configuration
├── useMonitorStore.ts       # Monitor data cache
├── useNotificationStore.ts  # Push notifications
├── useLogStore.ts           # Application logs (ephemeral)
└── useQueryCacheStore.ts    # API response cache
```

**Why multiple stores?**
- Separation of concerns
- Better performance (components subscribe to relevant store only)
- Easier to test and reason about

## Store Organization Pattern

Each store follows this pattern:

```tsx
// 1. Define state interface
interface MyState {
  // Data
  items: Item[];
  selectedId: string | null;

  // Actions
  addItem: (item: Item) => void;
  selectItem: (id: string) => void;
  clearSelection: () => void;
}

// 2. Create store with persistence
export const useMyStore = create<MyState>()(
  persist(
    (set, get) => ({
      // 3. Initial state
      items: [],
      selectedId: null,

      // 4. Actions
      addItem: (item) =>
        set((state) => ({ items: [...state.items, item] })),

      selectItem: (id) =>
        set({ selectedId: id }),

      clearSelection: () =>
        set({ selectedId: null }),
    }),
    {
      name: 'my-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
```

## Testing Zustand Stores

Stores can be tested independently:

```tsx
import { useProfileStore } from '../useProfileStore';

describe('ProfileStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useProfileStore.setState({
      currentProfile: null,
      profiles: [],
    });
  });

  it('sets current profile', () => {
    const profile = { id: '1', name: 'Test' };

    useProfileStore.getState().setCurrentProfile(profile);

    expect(useProfileStore.getState().currentProfile).toBe(profile);
  });

  it('adds profile to list', () => {
    const profile = { id: '1', name: 'Test' };

    useProfileStore.getState().addProfile(profile);

    expect(useProfileStore.getState().profiles).toContain(profile);
  });
});
```

## Key Takeaways

1. **Zustand is global state**: Any component can access it
2. **Use selectors**: Subscribe to specific parts of state to optimize re-renders
3. **Actions encapsulate logic**: Don't manipulate state directly from components
4. **Object references change**: Zustand values get new references even if unchanged
5. **Refs prevent loops**: Don't use Zustand values as `useCallback`/`useEffect` dependencies directly
6. **Multiple stores**: Separate concerns for better organization
7. **Persistence is automatic**: With the persist middleware
8. **Works outside React**: Can call `getState()` from anywhere

## Common Patterns

### Pattern 1: Derived State with Selectors

```tsx
const hasActiveMonitors = useMonitorStore((state) =>
  state.monitors.some(m => !m.deleted)
);
```

### Pattern 2: Multiple Actions in Sequence

```tsx
const resetApp = () => {
  useProfileStore.getState().clearProfiles();
  useDashboardStore.getState().resetDashboard();
  useMonitorStore.getState().clearCache();
};
```

### Pattern 3: Conditional Updates

```tsx
addMonitor: (monitor) =>
  set((state) => {
    // Don't add duplicates
    if (state.monitors.some(m => m.id === monitor.id)) {
      return state;  // Return current state unchanged
    }
    return { monitors: [...state.monitors, monitor] };
  }),
```

## Next Steps

Continue to [Chapter 4: Pages and Views](./04-pages-and-views.md) to see real examples of how Zustand object references caused infinite loops in our codebase and how we fixed them.
