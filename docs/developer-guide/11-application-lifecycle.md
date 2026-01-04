# Application Lifecycle

This chapter bridges the gap between individual concepts by explaining *how* the application runs from start to finish. It is the "Runtime Map" of zmNg.

## 1. The Entry Point (`index.html` → `main.tsx`)

Everything starts at `app/index.html`. It acts as the container for the React app.

1.  **Load**: Browser/Electron/Webview loads `index.html`.
2.  **Script**: It loads `src/main.tsx` (the TypeScript entry point).
3.  **Mount**: `main.tsx` finds the `<div id="root">` element and "mounts" the React application into it.

```tsx
// src/main.tsx
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

## 2. Bootstrapping Phase (`App.tsx`)

When `<App />` renders, the app is not yet ready to use. It must "hydrate" its state from storage.

### Data Hydration
The `useProfileStore` attempts to read saved profiles and the last active user from `AsyncStorage` (mobile) or `localStorage` (web).

-   **State**: `isInitialized` starts as `false`.
-   **Visual**: User sees `<RouteLoadingFallback />` (a spinner).
-   **Mechanism**: `zustand/persist` triggers `onRehydrateStorage`.

### Initialization Complete
Once storage is read:
1.  `isInitialized` becomes `true`.
2.  `AppRoutes` decides where to send the user:
    -   **No Profile**: Redirects to `/profiles/new`.
    -   **Has Profile**: Redirects to `/monitors` (or last visited route).

## 3. The Authentication Flow

zmNg handles authentication differently than a typical SaaS app because it connects to potentially *any* ZoneMinder server, each with different auth requirements.

### A. Token Exchange
When you log in or the app wakes up:
1.  **Credentials**: We retrieve the username/password (decrypted from SecureStorage).
2.  **Login API**: We call `POST /api/host/login`.
3.  **Response**: Server returns `access_token` and `refresh_token`.
4.  **Store**: Tokens are saved to `useAuthStore` (in memory mostly, refresh token persisted).

### B. The "Refresh Loop"
Tokens expire (usually after 1 hour). We need to verify we are still logged in.
-   **Hook**: `useTokenRefresh` runs in `App.tsx`.
-   **Logic**: It sets a timer. When the token is about to expire, it silently calls the refresh API to get a new one.
-   **Nuance**: If refresh fails (e.g., user changed password), we forcibly logout and redirect to login screen.

## 4. The "Main Loop" (Runtime)

Once logged in and on the Dashboard, several background processes keep the app alive.

1.  **Event Polling**: The Timeline view polls for new events (`useTimelineStore`).
2.  **Monitor Status**: `useMonitorStore` polls for monitor status (Capture/Idle).
3.  **Stream Keep-Alive**: Streaming connections (`useMonitorStream`) monitor their own health. If a stream dies (socket close), they automatically try to reconnect with a new "Connection Key".

## 5. Mobile Lifecycle (Capacitor)

On iOS and Android, the app has unique lifecycle states handled by the OS.

### Backgrounding
When the user swipes the app away (but doesn't close it):
-   **State**: App goes to "Background".
-   **Limit**: JS execution pauses (mostly).
-   **Streams**: Video streams are paused to save battery/data.

### Resuming
When the user re-opens the app:
-   **State**: App comes to "Foreground".
-   **Check**: We check `last_interaction` timestamp.
-   **Security**: If enabled, we might ask for Biometric Auth (FaceID) before revealing the screen.
-   **Reconnect**: Video streams detect the interruption and reconnect.

## 6. Navigation Lifecycle

We use `react-router-dom` for navigation.

-   **Routes**: Defined in `App.tsx`.
-   **Behavior**: When you navigate from `/monitors` to `/events`:
    1.  `MonitorList` component **unmounts** (cleanup functions run, streams close).
    2.  `EventList` component **mounts** (useEffect runs, API calls start).

**Critical Nuance**:
Because components unmount, **local state is lost**. If you scroll down the event list, click an event, and go back, you lose your scroll position *unless* you save it in a global Store (Zustand).

## Summary: The flow of a generic session

1.  **Launch**: App opens (`main.tsx`).
2.  **Hydrate**: Spinner shows while loading Storage.
3.  **Route**: Storage says "User was on Monitors page".
4.  **Auth**: App silently refreshes the old token.
5.  **Render**: `MonitorList` mounts.
6.  **Fetch**: Component calls `useQuery` to get monitors.
7.  **Stream**: `MonitorCard` calls `useMonitorStream` to get a video URL.
8.  **Interaction**: User clicks a monitor.
9.  **Navigate**: App switches URL to `/monitors/1`.
10. **Cleanup**: List unmounts, Detail view mounts.
