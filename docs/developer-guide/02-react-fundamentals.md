# React Fundamentals

This chapter explains React from first principles for programmers unfamiliar with React's mental model.

## What is React?

React is a library for building user interfaces. Unlike traditional approaches where you imperatively manipulate the DOM (Document Object Model), React uses a **declarative** approach:

**Traditional (Imperative)**:
```javascript
// Tell the browser HOW to update the UI
const button = document.getElementById('myButton');
button.textContent = 'Clicked ' + count + ' times';
button.style.color = count > 5 ? 'red' : 'black';
```

**React (Declarative)**:
```jsx
// Describe WHAT the UI should look like
<button style={{ color: count > 5 ? 'red' : 'black' }}>
  Clicked {count} times
</button>
```

You describe what the UI should look like for any given state, and React figures out how to update the DOM efficiently.

## Components: The Building Blocks

A component is a function that returns UI elements. Think of it like a reusable template:

```tsx
// A simple component
function Welcome({ name }: { name: string }) {
  return <Text>Hello, {name}!</Text>;
}

// Usage
<Welcome name="Alice" />
// Renders: "Hello, Alice!"
```

### JSX: JavaScript + XML

The `<Text>` syntax is called JSX. It looks like HTML but is actually JavaScript:

```tsx
// This JSX:
const element = <Text>Hello</Text>;

// Gets compiled to:
const element = React.createElement(Text, null, 'Hello');
```

**Key Points**:
- JSX is syntactic sugar for function calls
- You can embed JavaScript expressions in `{}`
- Components must return a single root element

```tsx
function UserCard({ user }: { user: User }) {
  return (
    <View>  {/* Single root element */}
      <Text>{user.name}</Text>
      <Text>{user.email}</Text>
    </View>
  );
}
```

## Props: Passing Data to Components

Props (properties) are how you pass data into components. They're **immutable** - a component cannot modify its own props.

```tsx
interface MonitorCardProps {
  monitorId: string;
  name: string;
  onPress: () => void;
}

function MonitorCard({ monitorId, name, onPress }: MonitorCardProps) {
  // Props are read-only
  // name = 'Something else';  // ❌ Don't do this!

  return (
    <Pressable onPress={onPress}>
      <Text>{name}</Text>
    </Pressable>
  );
}
```

Think of props like function parameters - they flow one direction (parent → child).

## State: Component Memory

State is data that a component owns and can change. When state changes, React re-renders the component.

### useState Hook

```tsx
import { useState } from 'react';

function Counter() {
  // Declare state: [currentValue, functionToUpdateIt]
  const [count, setCount] = useState(0);  // Initial value: 0

  const increment = () => {
    setCount(count + 1);  // Update state
  };

  return (
    <View>
      <Text>Count: {count}</Text>
      <Pressable onPress={increment}>
        <Text>Increment</Text>
      </Pressable>
    </View>
  );
}
```

**Key Points**:
- State updates are **asynchronous**
- Never mutate state directly: `count++` ❌, `setCount(count + 1)` ✅
- When state updates, the component re-renders with the new value

### State Updates and Closures

This is a common pitfall:

```tsx
function Counter() {
  const [count, setCount] = useState(0);

  const incrementTwice = () => {
    setCount(count + 1);  // count is 0, so this sets to 1
    setCount(count + 1);  // count is STILL 0, so this also sets to 1
    // Result: count becomes 1, not 2!
  };

  // Correct approach: use updater function
  const incrementTwiceCorrect = () => {
    setCount(prev => prev + 1);  // prev is 0, returns 1
    setCount(prev => prev + 1);  // prev is 1, returns 2
    // Result: count becomes 2
  };
}
```

## Rendering and Re-rendering

Understanding when and why components re-render is crucial to avoiding performance issues and infinite loops.

### When Components Re-render

A component re-renders when:
1. **Its state changes** (`useState` setter is called)
2. **Its props change** (parent passes new values)
3. **Its parent re-renders** (even if props didn't change)

```tsx
function Parent() {
  const [count, setCount] = useState(0);

  return (
    <View>
      <Child name="Alice" />  {/* Re-renders when Parent re-renders */}
      <Pressable onPress={() => setCount(count + 1)}>
        <Text>Increment: {count}</Text>
      </Pressable>
    </View>
  );
}
```

### Rendering is Pure

Each render is a **snapshot** in time. The component function is called with current props and state:

```tsx
function Message() {
  const [text, setText] = useState('Hello');

  const handleClick = () => {
    setText('Goodbye');
    alert(text);  // Still shows 'Hello'! Why?
  };

  // Each render creates a NEW handleClick function with text
  // captured at that moment
}
```

## Hooks: React's Power Tools

Hooks are functions that let you "hook into" React features. They must follow two rules:

1. **Only call at the top level** (not in loops, conditions, or nested functions)
2. **Only call from React functions** (components or custom hooks)

### useEffect: Side Effects

`useEffect` runs code after the component renders. Use it for:
- Data fetching
- Subscriptions
- Manually changing the DOM
- Setting up timers

```tsx
import { useEffect, useState } from 'react';

function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    // This runs AFTER the component renders
    fetchUser(userId).then(data => setUser(data));
  }, [userId]);  // Dependencies: re-run when userId changes

  if (!user) return <Text>Loading...</Text>;
  return <Text>{user.name}</Text>;
}
```

**Dependency Array Explained**:
- `[]` - Run once after first render (like componentDidMount)
- `[userId]` - Run when userId changes
- No array - Run after every render (usually a mistake!)

**Cleanup Functions**:
```tsx
useEffect(() => {
  const timer = setInterval(() => {
    console.log('Tick');
  }, 1000);

  // Cleanup: runs when component unmounts or before re-running effect
  return () => {
    clearInterval(timer);
  };
}, []);
```

### useCallback: Memoizing Functions

Every render creates new function instances. This can cause problems:

```tsx
function Parent() {
  const [count, setCount] = useState(0);

  // This creates a NEW function on every render
  const handleClick = () => {
    console.log('Clicked');
  };

  return <Child onClick={handleClick} />;  // Child sees a "new" prop every time
}
```

`useCallback` returns the same function instance across renders:

```tsx
import { useCallback } from 'react';

function Parent() {
  const [count, setCount] = useState(0);

  // This returns the SAME function instance if dependencies don't change
  const handleClick = useCallback(() => {
    console.log('Clicked');
  }, []);  // Empty array = never changes

  return <Child onClick={handleClick} />;  // Child sees same function reference
}
```

**When to use**:
- Passing callbacks to child components wrapped in `React.memo`
- Using functions as dependencies in other hooks
- Preventing unnecessary re-renders

**Dependencies matter**:
```tsx
const handleSave = useCallback(() => {
  saveData(userId, formData);
}, [userId, formData]);  // Re-create when userId or formData changes
```

### useRef: Persistent Storage Without Re-renders

`useRef` gives you a mutable object that persists across renders but doesn't trigger re-renders when changed:

```tsx
import { useRef } from 'react';

function VideoPlayer() {
  const playerRef = useRef(null);  // Initial value

  const play = () => {
    playerRef.current?.play();  // Access via .current
  };

  return <video ref={playerRef} />;
}
```

**Differences from state**:
- Changing `ref.current` **does NOT** trigger a re-render
- You can read/write `ref.current` immediately (synchronous)
- Useful for storing: DOM elements, timers, previous values

**Example: Tracking previous value**:
```tsx
function Counter() {
  const [count, setCount] = useState(0);
  const prevCountRef = useRef(0);

  useEffect(() => {
    prevCountRef.current = count;  // Update after render
  });

  return (
    <View>
      <Text>Current: {count}</Text>
      <Text>Previous: {prevCountRef.current}</Text>
    </View>
  );
}
```

### useMemo: Memoizing Values

Similar to `useCallback` but for values instead of functions:

```tsx
import { useMemo } from 'react';

function MonitorList({ monitors }: { monitors: Monitor[] }) {
  // Expensive calculation only runs when monitors change
  const sortedMonitors = useMemo(() => {
    return monitors.sort((a, b) => a.name.localeCompare(b.name));
  }, [monitors]);

  return (
    <View>
      {sortedMonitors.map(m => <MonitorCard key={m.id} monitor={m} />)}
    </View>
  );
}
```

**When to use**:
- Expensive calculations
- Creating objects/arrays used as dependencies
- Optimizing performance (profile first!)

## Object Identity and Re-renders

This is crucial for understanding infinite loops (covered in Chapter 4):

```tsx
// Every render creates a NEW object (different reference)
const config = { width: 100, height: 200 };

// Every render creates a NEW array (different reference)
const items = [1, 2, 3];

// Even if the values are identical, they're different objects!
{ width: 100 } !== { width: 100 }  // true - different references
[1, 2, 3] !== [1, 2, 3]            // true - different references
```

**Why this matters**:
```tsx
function Component() {
  const config = { width: 100 };  // New object every render

  useEffect(() => {
    console.log('Config changed!');
  }, [config]);  // This runs on EVERY render!
}
```

**Solution**:
```tsx
// Option 1: useMemo
const config = useMemo(() => ({ width: 100 }), []);  // Same object

// Option 2: Move outside component
const CONFIG = { width: 100 };  // Created once

// Option 3: Don't use as dependency (use refs - see Chapter 4)
```

## React.memo: Preventing Unnecessary Re-renders

`React.memo` is a higher-order component that optimizes performance by preventing a component from re-rendering when its props haven't changed.

### The Problem

By default, a component re-renders whenever its parent re-renders, even if its props are identical:

```tsx
function Parent() {
  const [count, setCount] = useState(0);

  return (
    <View>
      <Pressable onPress={() => setCount(count + 1)}>
        <Text>Count: {count}</Text>
      </Pressable>
      <ExpensiveChild name="Alice" />  {/* Re-renders every time! */}
    </View>
  );
}

function ExpensiveChild({ name }: { name: string }) {
  console.log('ExpensiveChild rendered');
  // Expensive rendering logic...
  return <Text>Hello, {name}</Text>;
}
```

Every time you click the button, `ExpensiveChild` re-renders even though its `name` prop never changes. This wastes CPU cycles.

### The Solution: React.memo

Wrap the component in `memo()` to skip re-renders when props are unchanged:

```tsx
import { memo } from 'react';

const ExpensiveChild = memo(function ExpensiveChild({ name }: { name: string }) {
  console.log('ExpensiveChild rendered');
  return <Text>Hello, {name}</Text>;
});
```

Now `ExpensiveChild` only re-renders when the `name` prop changes.

### How It Works

1. React compares the **new props** with the **previous props**
2. Uses **shallow equality** - compares references, not deep values
3. If props are identical (same references), skip re-render
4. If any prop changed, re-render normally

```tsx
const prev = { name: 'Alice', age: 30 };
const next = { name: 'Alice', age: 30 };

prev === next  // false! Different objects
prev.name === next.name  // true - same value
```

`memo()` does: `prev.name === next.name && prev.age === next.age`

### When to Use React.memo

**✅ Good use cases:**
- Component renders expensive UI (complex calculations, SVG, animations)
- Component is in a large list (50+ items)
- Props rarely change
- Parent re-renders frequently

**❌ Don't use when:**
- Component is cheap to render
- Props change on every render anyway
- Only one instance exists
- You haven't profiled to confirm it's slow

**Rule of thumb**: Only use `memo()` after you've identified a performance problem. Premature optimization adds complexity.

### Example: List Optimization

```tsx
function MonitorList({ monitors }: { monitors: Monitor[] }) {
  return (
    <View>
      {monitors.map(monitor => (
        <MonitorCard key={monitor.id} monitor={monitor} />
      ))}
    </View>
  );
}

// Without memo: updating one monitor re-renders all cards
// With memo: only the updated monitor's card re-renders
const MonitorCard = memo(function MonitorCard({ monitor }: { monitor: Monitor }) {
  return (
    <View>
      <Text>{monitor.name}</Text>
      <Text>{monitor.status}</Text>
    </View>
  );
});
```

### Custom Comparison Function

By default, `memo()` does shallow comparison. For custom logic, provide a comparison function:

```tsx
const MonitorCard = memo(
  function MonitorCard({ monitor, showDetails }) {
    // ...
  },
  (prevProps, nextProps) => {
    // Return true if props are equal (skip re-render)
    // Return false if props changed (do re-render)
    return (
      prevProps.monitor.id === nextProps.monitor.id &&
      prevProps.monitor.status === nextProps.monitor.status &&
      prevProps.showDetails === nextProps.showDetails
    );
  }
);
```

### Important: memo() with Global State

**Critical caveat**: `memo()` only compares **props**. It doesn't prevent re-renders from state changes inside the component.

```tsx
const EventCard = memo(function EventCard({ event }) {
  // This will still cause re-renders when favorites change
  const isFavorited = useStore((state) => state.isFavorited(event.id));

  return <Star filled={isFavorited} />;
});
```

`memo()` blocks re-renders from the parent, but the component still subscribes to the store. When the store changes, the component re-renders.

This is correct behavior! The component needs to update when its data changes.

### Common Mistake: Extracting Functions Without Subscribing

```tsx
// ❌ WRONG - Won't update when favorites change
const EventCard = memo(function EventCard({ event }) {
  const { isFavorited } = useStore();  // Extracts function, doesn't subscribe
  const isFav = isFavorited(event.id);  // Computed once, never updates

  return <Star filled={isFav} />;
  // When favorites change:
  // - Store doesn't notify this component (no subscription)
  // - Parent doesn't re-render (no prop change)
  // - memo() blocks re-render from parent
  // - Star stays stale!
});

// ✅ CORRECT - Subscribe to state
const EventCard = memo(function EventCard({ event }) {
  // Subscribes to this specific state value
  const isFav = useStore((state) => state.isFavorited(event.id));

  return <Star filled={isFav} />;
  // When favorites change:
  // - Store notifies this component (subscribed)
  // - Component re-renders with new value
  // - Star updates correctly!
});
```

**Key principle**: When using `memo()` with global state (Zustand, Redux, Context), you must subscribe to the state with a selector. Extracting functions without subscribing breaks reactivity.

## React Native Specifics

zmNg uses React Native components, not HTML:

| HTML | React Native |
|------|-------------|
| `<div>` | `<View>` |
| `<span>` | `<Text>` |
| `<button>` | `<Pressable>` |
| `<input>` | `<TextInput>` |

But the React concepts are identical.

## Key Takeaways

1. **React is declarative**: Describe the UI for any state, React handles updates
2. **Components are functions**: They take props and return UI
3. **State triggers re-renders**: Changing state causes the component to re-render
4. **Hooks have rules**: Top-level only, React functions only
5. **Object identity matters**: New objects/arrays are different references
6. **useCallback/useMemo**: Preserve identity across renders
7. **useRef**: Store values without triggering re-renders
8. **useEffect**: Run side effects after render

## Next Steps

Continue to [Chapter 3: State Management with Zustand](./03-state-management-zustand.md) to understand how we manage global application state.
