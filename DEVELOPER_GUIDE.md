# zmNg Codebase - Comprehensive Developer Walkthrough

## Project Overview

**zmNg** is a modern, multi-platform ZoneMinder client built with React, TypeScript, and Vite. It's designed to work across web browsers, desktop (via Tauri), and mobile platforms (iOS/Android via Capacitor). The application provides a clean interface for monitoring security cameras, reviewing events, and managing multiple ZoneMinder server profiles.

### Key Technologies
- **Frontend Framework**: React 19.2 with TypeScript
- **Build Tool**: Vite 7.2
- **UI Framework**: Radix UI components + Tailwind CSS
- **State Management**: Zustand (with persistence)
- **Data Fetching**: TanStack React Query (v5)
- **Routing**: React Router DOM v7
- **Internationalization**: i18next
- **Form Handling**: React Hook Form + Zod validation
- **Desktop**: Tauri 2.x (Rust backend)
- **Mobile**: Capacitor 7.x (iOS/Android)
- **Testing**: Vitest (unit) + Playwright (E2E with BDD)

---

## Project Structure

### Root Directory

```
app/
├── src/                      # Main source code
│   ├── api/                  # API client and ZoneMinder API wrappers
│   ├── components/           # React components
│   │   ├── ui/              # Reusable UI components (Radix + shadcn/ui)
│   │   ├── dashboard/       # Dashboard widgets
│   │   ├── events/          # Event-related components
│   │   ├── monitors/        # Monitor cards, PTZ controls
│   │   ├── settings/        # Settings panels
│   │   ├── filters/         # Filter components
│   │   └── layout/          # Layout components (AppLayout)
│   ├── pages/               # Route pages
│   ├── stores/              # Zustand state stores
│   ├── hooks/               # Custom React hooks
│   ├── services/            # Business logic services
│   ├── lib/                 # Utility functions and helpers
│   ├── locales/             # i18n translation files (en, es, fr, de, zh)
│   ├── styles/              # CSS files
│   ├── types/               # TypeScript type definitions
│   ├── tests/               # Test setup files
│   ├── main.tsx             # React entry point
│   ├── App.tsx              # Main app component with routing
│   ├── i18n.ts              # i18next configuration
│   └── index.css            # Global styles
├── tests/                    # E2E tests (Playwright + BDD)
│   ├── features/            # Gherkin feature files
│   └── steps.ts             # Step definitions
├── src-tauri/               # Tauri desktop app (Rust)
├── android/                 # Capacitor Android project
├── ios/                     # Capacitor iOS project
├── public/                  # Static assets
├── dist/                    # Production build output
├── package.json             # Node dependencies and scripts
├── vite.config.ts           # Vite configuration
├── vitest.config.ts         # Vitest configuration
├── playwright.config.ts     # Playwright E2E configuration
├── tailwind.config.js       # Tailwind CSS configuration
├── tsconfig.json            # TypeScript configuration (root)
├── tsconfig.app.json        # App TypeScript config
├── capacitor.config.ts      # Capacitor configuration
├── proxy-server.js          # Development CORS proxy
└── .env.example             # Environment variables template
```

---

## Entry Points and Application Flow

### 1. HTML Entry Point: `index.html`
```html
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
```
- Simple HTML5 document
- Loads React app via Vite's ES modules

### 2. React Entry Point: `src/main.tsx`
```typescript
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```
- Initializes React 19
- Imports i18n setup (`./i18n`)
- Renders the main `App` component

### 3. Main App Component: `src/App.tsx`

**Key Responsibilities:**
- Sets up application providers:
  - `QueryClientProvider` (TanStack Query)
  - `ThemeProvider` (dark/light mode)
  - `HashRouter` (React Router with hash routing for mobile/desktop)
  - `ErrorBoundary` (global error handling)
  - `NotificationHandler` (push notifications)

- Lazy loads all route components for code splitting
- Manages app initialization state
- Handles profile bootstrapping (auth, timezone, ZMS path fetching)
- Shows loading screen during initialization

**Route Structure:**
```typescript
<Routes>
  <Route path="/" element={<Navigate to lastRoute || "/monitors" />} />
  <Route path="/profiles/new" element={<ProfileForm />} />

  <Route element={<AppLayout />}>  {/* Nested routes with sidebar */}
    <Route path="/dashboard" element={<Dashboard />} />
    <Route path="/monitors" element={<Monitors />} />
    <Route path="/monitors/:id" element={<MonitorDetail />} />
    <Route path="/montage" element={<Montage />} />
    <Route path="/events" element={<Events />} />
    <Route path="/events/:id" element={<EventDetail />} />
    <Route path="/timeline" element={<Timeline />} />
    <Route path="/profiles" element={<Profiles />} />
    <Route path="/notifications" element={<NotificationSettings />} />
    <Route path="/notifications/history" element={<NotificationHistory />} />
    <Route path="/settings" element={<Settings />} />
    <Route path="/server" element={<Server />} />
    <Route path="/logs" element={<Logs />} />
  </Route>
</Routes>
```

---

## State Management Architecture (Zustand)

The application uses **Zustand** for state management with persistence to localStorage. Each store is modular and handles a specific domain.

### Core Stores

#### 1. **Profile Store** (`src/stores/profile.ts`)
**Purpose:** Manages ZoneMinder server profiles and profile switching

**State:**
- `profiles: Profile[]` - List of server profiles
- `currentProfileId: string | null` - Active profile ID
- `isInitialized: boolean` - App initialization status
- `isBootstrapping: boolean` - Bootstrap in progress

**Key Features:**
- Password storage in secure storage (Keychain/Keystore on mobile, encrypted localStorage on web)
- Profile switching with full state cleanup (auth, cache, API client reset)
- Auto-login on app startup using stored credentials
- Fetches server timezone and ZMS path on profile load
- Bootstrap process with timeout protection (5s per step, 20s total)

**Critical Flow - Profile Bootstrap:**
```typescript
onRehydrateStorage ->
  1. Clear auth/cache
  2. Initialize API client
  3. Authenticate (if credentials exist)
  4. Fetch server timezone
  5. Fetch ZMS path from server config
  6. Update CGI URL if needed
  -> Set isInitialized = true
```

#### 2. **Auth Store** (`src/stores/auth.ts`)
**Purpose:** JWT token management and authentication state

**State:**
- `accessToken: string | null` - Short-lived access token (memory only)
- `refreshToken: string | null` - Long-lived refresh token (persisted)
- `accessTokenExpires: number | null` - Absolute expiration timestamp
- `refreshTokenExpires: number | null` - Absolute expiration timestamp
- `isAuthenticated: boolean`

**Key Actions:**
- `login(username, password)` - Authenticate and store tokens
- `logout()` - Clear all tokens
- `refreshAccessToken()` - Refresh using refresh token
- `setTokens(response)` - Update tokens from API response

**Security Design:**
- Access tokens stored in memory only (not persisted)
- Refresh tokens persisted to localStorage
- Tokens expire based on server-provided expiration times

#### 3. **Monitor Store** (`src/stores/monitors.ts`)
**Purpose:** Connection key management for monitor streams

**State:**
- `connKeys: Record<string, number>` - Map of monitor ID to connection key

**Key Actions:**
- `getConnKey(monitorId)` - Get or generate connection key
- `regenerateConnKey(monitorId)` - Force new connection key

#### 4. **Settings Store** (`src/stores/settings.ts`)
**Purpose:** User preferences per profile

**Settings:**
- `displayMode: 'normal' | 'compact'`
- `logLevel: LogLevel`
- `language: string`
- `dashboardLayout: LayoutConfig`
- `monitorsFeedFit: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down'`
- `eventsFeedFit: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down'`
- `insomnia: boolean` - Prevent screen sleep
- `lastRoute: string` - Last visited route for persistence

#### 5. **Notifications Store** (`src/stores/notifications.ts`)
**Purpose:** Push notification management (FCM)

**State:**
- Notification settings per profile
- WebSocket connection state
- Unread notification counts
- Notification history

#### 6. **Dashboard Store** (`src/stores/dashboard.ts`)
**Purpose:** Dashboard widget layout configuration

#### 7. **Logs Store** (`src/stores/logs.ts`)
**Purpose:** In-app log viewer state

---

## API Layer Architecture

### API Client Setup (`src/api/client.ts`)

**Key Features:**
- **Platform-aware routing:**
  - Web Dev: Proxy server (`http://localhost:3001/proxy`) with `X-Target-Host` header
  - Web Prod: Direct to ZoneMinder server
  - Mobile: Native HTTP adapter (Capacitor HTTP - bypasses CORS)
  - Desktop: Tauri HTTP adapter

- **Automatic token injection:**
  - Adds `token` query parameter to all API requests
  - Uses access token for normal requests
  - Uses refresh token for login.json re-authentication

- **Automatic token refresh:**
  - Intercepts 401 responses
  - Attempts refresh using refresh token
  - Falls back to re-login using stored credentials
  - Retries original request after successful refresh

- **Request/Response logging** (dev mode only)
- **Error handling** with rollback support

### Native HTTP Adapter (`src/api/adapter.ts`)

**Purpose:** Custom Axios adapter for Capacitor and Tauri

**Why needed:**
- Browsers enforce CORS policies
- Native platforms can bypass CORS with native HTTP
- Tauri has its own HTTP plugin

**Flow:**
```typescript
Axios request ->
  Platform check ->
    If Capacitor: Use CapacitorHttp.request()
    If Tauri: Use @tauri-apps/plugin-http
    Else: Use Axios default adapter
  -> Return response in Axios format
```

### API Modules

All located in `src/api/`

#### `auth.ts` - Authentication API
- `login({ user, pass })` - Login with credentials
- `refreshToken(token)` - Refresh access token
- `fetchZmsPath()` - Get ZM_PATH_ZMS config from server

#### `monitors.ts` - Monitor API
- `getMonitors()` - Fetch all monitors
- `getMonitorById(id)` - Get single monitor
- `getControl(monitorId)` - Get PTZ control config
- `sendPTZCommand(monitorId, command)` - Control PTZ camera

#### `events.ts` - Events API
- `getEvents(params)` - Fetch events with pagination/filtering
- `getEventById(id)` - Get event details
- `getConsoleEvents(period)` - Get event counts by monitor
- `deleteEvent(id)` - Delete event

#### `server.ts` - Server Config API
- `getServerConfig()` - Get ZoneMinder configuration
- `getServerStats()` - Get server statistics

#### `states.ts` - Run States API
- `getStates()` - Get ZoneMinder run states

#### `time.ts` - Time/Timezone API
- `getServerTimeZone(token?)` - Fetch server timezone

#### `types.ts` - Type Definitions
**Zod Schemas for runtime validation:**
- `LoginResponseSchema`
- `MonitorSchema`
- `EventSchema`
- `ConfigSchema`
- Plus TypeScript types inferred from schemas

---

## Component Architecture

### Layout Component: `src/components/layout/AppLayout.tsx`

**Key Features:**
- **Responsive sidebar:**
  - Desktop: Draggable, collapsible sidebar (60-256px width)
  - Mobile: Slide-out drawer (Sheet component)

- **Navigation items:**
  - Dashboard, Monitors, Montage, Events, Timeline, Notifications, Profiles, Settings, Server, Logs

- **Sidebar controls:**
  - Profile switcher
  - Theme toggle (dark/light mode)
  - Language switcher
  - Insomnia toggle (prevent screen sleep)
  - Notification status indicator

- **Route persistence:**
  - Saves last visited route to settings
  - Restores on app reload

### UI Components (`src/components/ui/`)

Built with **Radix UI primitives** + **shadcn/ui** patterns:

- `button.tsx` - Button variants (default, outline, ghost, destructive)
- `card.tsx` - Card container
- `dialog.tsx` - Modal dialogs
- `dropdown-menu.tsx` - Dropdown menus
- `input.tsx` - Text input
- `select.tsx` - Select dropdown
- `switch.tsx` - Toggle switch
- `toast.tsx` - Toast notifications (sonner)
- `alert-dialog.tsx` - Confirmation dialogs
- `sheet.tsx` - Slide-out panel (mobile drawer)
- `tabs.tsx` - Tabbed interface
- `scroll-area.tsx` - Custom scrollbar
- `skeleton.tsx` - Loading placeholders
- `badge.tsx` - Status badges
- `slider.tsx` - Range slider
- `checkbox.tsx` - Checkbox
- `popover.tsx` - Popover menus
- `separator.tsx` - Horizontal divider

**Custom UI Components:**
- `video-player.tsx` - Video.js wrapper for event playback with markers
- `secure-image.tsx` - Image with auth token injection
- `password-input.tsx` - Password field with show/hide toggle
- `empty-state.tsx` - Empty state placeholder
- `quick-date-range-buttons.tsx` - Date range shortcuts
- `pull-to-refresh-indicator.tsx` - Pull-to-refresh visual feedback

### Page Components (`src/pages/`)

#### **Monitors** (`Monitors.tsx`)
- Grid of monitor cards
- Live stream thumbnails
- Status indicators (FPS, bandwidth)
- Event count badges
- Filter by feed fit (contain/cover/fill)
- Monitor properties dialog

#### **MonitorDetail** (`MonitorDetail.tsx`)
- Full-screen live stream
- PTZ controls (if supported)
- Zoom/pan gestures
- Stream quality settings
- Force alarm trigger
- Insomnia mode

#### **Montage** (`Montage.tsx`)
- Multi-monitor grid layout (react-grid-layout)
- Responsive breakpoints (lg, md, sm, xs)
- Drag-and-drop repositioning
- Resize monitors
- Auto-rotation mode
- Save/restore layouts per profile

#### **Events** (`Events.tsx`)
- List view vs Montage view toggle
- Pagination
- Filters: date range, monitors, cause
- Event thumbnails
- Heatmap visualization
- Swipe navigation between events

#### **EventDetail** (`EventDetail.tsx`)
- Event video playback (Video.js)
- Frame scrubbing with markers
- Alarm frame indicators
- Download options (video/frames)
- Event metadata
- Delete event

#### **Timeline** (`Timeline.tsx`)
- vis-timeline visualization
- Events grouped by monitor
- Time range selection
- Click to view event details

#### **Dashboard** (`Dashboard.tsx`)
- Customizable widget layout
- Widgets: Monitors, Events, Timeline, Heatmap
- Drag-and-drop arrangement
- Add/remove/edit widgets

#### **Profiles** (`Profiles.tsx`)
- List all server profiles
- Add/edit/delete profiles
- Set default profile
- Switch between profiles

#### **ProfileForm** (`ProfileForm.tsx`)
- Add/edit profile form
- Auto-discovery (find ZoneMinder servers on network)
- URL validation
- Credential storage (secure)
- Test connection

#### **Settings** (`Settings.tsx`)
- Tabbed settings panels:
  - Display settings (compact mode, feed fit)
  - Language settings
  - Event settings (pagination, filters)
  - Video settings (quality, autoplay)
  - Debug settings (log level, log viewer)
  - Dashboard settings (widget config)
  - Account settings (username, password)

#### **NotificationSettings** (`NotificationSettings.tsx`)
- Enable/disable push notifications
- FCM token registration
- Monitor-specific settings
- Test notifications

#### **Server** (`Server.tsx`)
- Server info (version, API version)
- Configuration viewer
- Storage stats
- Run states

#### **Logs** (`Logs.tsx`)
- In-app log viewer
- Filter by level (debug, info, warn, error)
- Filter by category
- Export logs
- Clear logs

---

## Custom Hooks (`src/hooks/`)

#### `useTokenRefresh.ts`
- Automatic access token refresh
- Checks token expiration every 30s
- Refreshes 5 minutes before expiry
- Handles refresh failures

#### `useMonitors.ts`
- Centralized monitor fetching
- Filters enabled monitors
- Returns monitor IDs array

#### `useEventPagination.ts`
- Event pagination logic
- Next/previous page
- Jump to page

#### `useCurrentProfile.ts`
- Get current profile with reactive updates

#### `useImageError.ts`
- Handle image loading errors
- Retry logic
- Fallback placeholder

#### `useMonitorStream.ts`
- Monitor stream URL generation
- Connection key management
- Cache busting

#### `usePullToRefresh.ts`
- Pull-to-refresh gesture (mobile)
- Uses @use-gesture/react

#### `useSwipeNavigation.ts`
- Swipe left/right navigation (mobile)

#### `usePinchZoom.ts`
- Pinch-to-zoom gesture (mobile/desktop)

#### `useInsomnia.ts`
- Prevent screen sleep (Capacitor plugin)
- Enable/disable based on setting

#### `use-toast.ts`
- Toast notification helper

---

## Services Layer (`src/services/`)

#### `profile.ts` - ProfileService
- `savePassword(profileId, password)` - Store password securely
- `getPassword(profileId)` - Retrieve password
- `deletePassword(profileId)` - Remove password
- `validateNameAvailability(name, profiles)` - Check duplicate names

#### `notifications.ts` - NotificationService
- FCM token management
- WebSocket connection handling
- Notification history storage

#### `pushNotifications.ts` - PushNotificationService
- Capacitor Push Notifications plugin wrapper
- FCM token registration
- Notification listeners

---

## Utility Library (`src/lib/`)

#### `secureStorage.ts`
**Purpose:** Cross-platform secure storage

**Implementation:**
- **Mobile:** Native Keychain (iOS) / Keystore (Android) via `@aparajita/capacitor-secure-storage`
- **Web:** AES-GCM encryption (Web Crypto API) + localStorage
  - PBKDF2 key derivation (100k iterations)
  - Per-value encryption with random salt/IV

**API:**
- `setSecureValue(key, value)`
- `getSecureValue(key)`
- `removeSecureValue(key)`
- `clearSecureStorage()`

#### `crypto.ts`
- `encrypt(plaintext)` - AES-GCM encryption
- `decrypt(ciphertext)` - AES-GCM decryption
- `deriveKey(password, salt)` - PBKDF2 key derivation
- `isCryptoAvailable()` - Check Web Crypto API support

#### `logger.ts`
**Purpose:** Structured logging system

**Features:**
- Log levels: DEBUG, INFO, WARN, ERROR
- Log categories: app, auth, api, profile, etc.
- Stores logs in memory (max 1000 entries)
- Log viewer in Settings
- Sanitizes sensitive data (passwords, tokens)

**API:**
```typescript
log.auth('Login successful', LogLevel.INFO, { user: 'admin' })
log.api('[Request] GET /monitors', LogLevel.DEBUG, { url: '...' })
```

#### `url-builder.ts`
**Purpose:** Build ZoneMinder stream/image URLs

**Functions:**
- `buildStreamUrl(monitor, options)` - Live stream URL
- `buildImageUrl(monitor, options)` - Snapshot image URL
- `buildEventVideoUrl(event)` - Event video URL
- `buildEventFrameUrl(event, frameId)` - Event frame image URL

#### `platform.ts`
**Purpose:** Platform detection utilities

**Properties:**
- `Platform.isDev` - Development mode
- `Platform.isNative` - iOS/Android
- `Platform.isTauri` - Desktop app
- `Platform.isWeb` - Web browser
- `Platform.shouldUseProxy` - Use dev proxy

#### `filters.ts`
- `filterEnabledMonitors(monitors)` - Remove deleted monitors

#### `time.ts`
- `convertToLocalTime(utcTime, timezone)` - Timezone conversion
- `formatDateTime(date)` - Format date/time

#### `download.ts`
- `downloadFile(url, filename)` - Download file with progress
- `downloadBlob(blob, filename)` - Download blob

#### `discovery.ts`
- `discoverZoneminderServers()` - Auto-discover ZM servers on local network
- Uses common ports and paths

#### `version.ts`
- `getAppVersion()` - Get app version from package.json

#### `utils.ts`
- `cn(...classes)` - Tailwind class merger (clsx + tailwind-merge)

---

## Styling and Theming

### Tailwind CSS Configuration (`tailwind.config.js`)

**Key Features:**
- CSS variables for theming (dark/light mode)
- Custom color palette (primary, secondary, destructive, muted, accent, etc.)
- Responsive breakpoints
- Custom animations (accordion, fade-in, etc.)
- Plugins: `tailwindcss-animate`

### Dark Mode

**Implementation:**
- Class-based dark mode (`darkMode: ["class"]`)
- `ThemeProvider` component manages theme state
- `ModeToggle` component for user control
- Persisted to localStorage

### Global Styles (`src/index.css`)

**Key Features:**
- CSS custom properties for colors (HSL format)
- Compact mode class (reduces spacing)
- Safe area insets for mobile (notch support)
- Smooth transitions

---

## Internationalization (i18n)

### Configuration (`src/i18n.ts`)

**Setup:**
- i18next with react-i18next
- Browser language detection
- Bundled translations (no HTTP requests)

**Languages:**
- English (en)
- Spanish (es)
- French (fr)
- German (de)
- Chinese (zh)

**Translation Files:**
- `src/locales/{lang}/translation.json`

**Usage:**
```typescript
const { t } = useTranslation();
<h1>{t('monitors.title')}</h1>
```

---

## Testing

### Unit Tests (Vitest)

**Configuration:** `vitest.config.ts`
- Environment: jsdom
- Setup file: `src/tests/setup.ts`
- Coverage: v8 provider

**Test Files:**
- `src/**/__tests__/**/*.test.ts(x)`
- Co-located with source files

**Running Tests:**
```bash
npm run test           # Run all tests
npm run test:ui        # Vitest UI
npm run test:coverage  # Coverage report
npm run test:watch     # Watch mode
```

### E2E Tests (Playwright + BDD)

**Configuration:** `playwright.config.ts`
- Framework: playwright-bdd
- Features: `tests/features/**/*.feature` (Gherkin)
- Steps: `tests/steps.ts`
- Browser: Chromium
- Base URL: `http://localhost:5173`

**Features:**
- Scenario outlines for data-driven tests
- Background steps for setup
- Screenshot on failure
- Video on retry
- Trace viewer

**Running E2E Tests:**
```bash
npm run test:e2e       # Run all E2E tests
npm run test:e2e:ui    # Playwright UI
```

**Sample Feature:**
```gherkin
Feature: Monitor Viewing
  Scenario: View live monitor
    Given I am logged in
    When I navigate to "monitors"
    And I click on monitor "Front Door"
    Then I should see the live stream
```

---

## Build and Development

### Development Mode

**Web Development:**
```bash
npm run dev                # Vite dev server (port 5173)
npm run dev:all            # Proxy + Vite
npm run dev:notifications  # Proxy + Mock notifications + Vite
```

**Desktop Development:**
```bash
npm run tauri:dev          # Tauri dev mode
```

**Mobile Development:**
```bash
npm run android            # Build + sync + run on Android
npm run ios                # Build + sync + run on iOS
```

### Production Builds

**Web:**
```bash
npm run build              # Build to dist/
npm run preview            # Preview production build
```

**Desktop:**
```bash
npm run tauri:build        # Build Tauri app (src-tauri/target/release/bundle/)
```

**Mobile:**
```bash
npm run android:release    # Android APK
npm run android:bundle     # Android AAB
npm run ios:sync           # Sync iOS project
```

### Build Tools

#### Vite (`vite.config.ts`)
- React plugin
- Base path: `./` (for mobile/desktop)
- Static file copying
- No proxy (uses standalone Express server)

#### TypeScript
- `tsconfig.json` - Root config (project references)
- `tsconfig.app.json` - App config (strict mode, JSX)
- `tsconfig.node.json` - Node config (build scripts)

#### Tauri (`src-tauri/tauri.conf.json`)
- App ID: `com.pliablepixels.zmng`
- Frontend: `dist/`
- Dev URL: `http://localhost:5173`
- Window: 800x600, resizable
- Plugins: tauri-plugin-http, tauri-plugin-log

#### Capacitor (`capacitor.config.ts`)
- App ID: `com.pliablepixels.zmng`
- Web dir: `dist/`
- Android scheme: `http` (avoid CORS)
- iOS scheme: `http`
- Splash screen: 3s duration, manual hide

---

## Proxy Server (`proxy-server.js`)

**Purpose:** CORS workaround for development

**Features:**
- API proxy: `/proxy` route with `X-Target-Host` header
- Image proxy: `/image-proxy?url=...` route
- CORS headers for all responses
- Runs on port 3001

**Usage:**
- Start: `npm run proxy`
- Or: `npm run dev:all` (proxy + vite)

**How it works:**
1. Frontend sends request to `http://localhost:3001/proxy/api/monitors.json`
2. Adds header `X-Target-Host: https://your-zm-server.com`
3. Proxy forwards to `https://your-zm-server.com/api/monitors.json`
4. Response proxied back with CORS headers

---

## Mobile-Specific Features

### Capacitor Plugins Used

1. **@capacitor/core** - Core APIs
2. **@capacitor/filesystem** - File access
3. **@capacitor/preferences** - Key-value storage
4. **@capacitor/push-notifications** - FCM push notifications
5. **@capacitor/share** - Native share sheet
6. **@capacitor/splash-screen** - Splash screen control
7. **@aparajita/capacitor-secure-storage** - Keychain/Keystore access
8. **@capacitor-community/media** - Media playback

### Mobile Gestures

- **Pull-to-refresh:** `usePullToRefresh` hook
- **Swipe navigation:** `useSwipeNavigation` hook
- **Pinch-to-zoom:** `usePinchZoom` hook
- **Insomnia (keep awake):** `useInsomnia` hook

### Safe Area Handling

CSS uses safe area insets for notch support:
```css
padding-top: env(safe-area-inset-top);
padding-bottom: env(safe-area-inset-bottom);
padding-left: env(safe-area-inset-left);
padding-right: env(safe-area-inset-right);
```

---

## Desktop-Specific Features (Tauri)

### Tauri Backend (`src-tauri/src/`)

**Rust Dependencies:**
- `tauri` - Core framework
- `tauri-plugin-http` - HTTP client (bypass CORS)
- `tauri-plugin-log` - Logging
- `serde` / `serde_json` - Serialization

**Why Tauri:**
- Small binary size (~3-10 MB)
- Native HTTP (no CORS issues)
- Native filesystem access
- Cross-platform (Windows, macOS, Linux)

---

## Configuration Files

### Environment Variables (`.env`)

**Development/Testing:**
```bash
ZM_HOST_1=https://demo.zoneminder.com
ZM_USER_1=
ZM_PASSWORD_1=

ZM_HOST_2=https://your-server.com
ZM_USER_2=admin
ZM_PASSWORD_2=password123
```

**Proxy Settings:**
```bash
ZM_PROXY_INSECURE=1  # Allow self-signed certs (dev only)
```

### ESLint (`eslint.config.js`)
- React plugin
- TypeScript support
- React hooks rules
- React refresh rules

### PostCSS (`postcss.config.js`)
- Tailwind CSS
- Autoprefixer

---

## Key Architectural Patterns

### 1. **Profile-Scoped State**
- All stores/settings are keyed by profile ID
- Switching profiles clears all state
- Prevents data mixing between profiles

### 2. **Token Management**
- Access tokens in memory (security)
- Refresh tokens persisted (convenience)
- Automatic refresh before expiry
- Automatic re-login on 401

### 3. **Platform Abstraction**
- `Platform` utility for environment checks
- HTTP adapter pattern for CORS bypass
- Secure storage abstraction (native vs web)

### 4. **Error Boundaries**
- Global error boundary (`ErrorBoundary`)
- Per-route error boundaries (`RouteErrorBoundary`)
- Toast notifications for user-facing errors

### 5. **Lazy Loading**
- All route components lazy loaded
- Code splitting per page
- Loading fallback component

### 6. **Type Safety**
- Zod schemas for API validation
- TypeScript strict mode
- Type inference from Zod schemas

### 7. **Optimistic UI Updates**
- React Query caching
- Stale-while-revalidate
- Refetch on window focus (disabled)

---

## Development Workflow

### 1. **Add a New Page**

1. Create component in `src/pages/NewPage.tsx`
2. Add route in `src/App.tsx`:
   ```typescript
   const NewPage = lazy(() => import('./pages/NewPage'));

   <Route path="/newpage" element={
     <RouteErrorBoundary routePath="/newpage">
       <NewPage />
     </RouteErrorBoundary>
   } />
   ```
3. Add navigation item in `src/components/layout/AppLayout.tsx`
4. Add translations in `src/locales/*/translation.json`

### 2. **Add a New API Endpoint**

1. Define types in `src/api/types.ts`:
   ```typescript
   export const NewDataSchema = z.object({
     id: z.string(),
     name: z.string(),
   });
   export type NewData = z.infer<typeof NewDataSchema>;
   ```

2. Create API function in `src/api/newdata.ts`:
   ```typescript
   export async function getNewData() {
     const { data } = await getApiClient().get('/api/newdata.json');
     return NewDataSchema.parse(data);
   }
   ```

3. Use in component with React Query:
   ```typescript
   const { data, isLoading } = useQuery({
     queryKey: ['newdata'],
     queryFn: getNewData,
   });
   ```

### 3. **Add a New Setting**

1. Update settings store in `src/stores/settings.ts`:
   ```typescript
   interface ProfileSettings {
     // ... existing
     newSetting: string;
   }

   const defaultSettings = {
     // ... existing
     newSetting: 'default',
   };
   ```

2. Add UI in appropriate settings panel (`src/components/settings/`)

3. Use in component:
   ```typescript
   const settings = useSettingsStore(state =>
     state.getProfileSettings(profileId)
   );
   const updateSettings = useSettingsStore(state =>
     state.updateProfileSettings
   );

   updateSettings(profileId, { newSetting: 'new value' });
   ```

### 4. **Add a New UI Component**

1. Create in `src/components/ui/NewComponent.tsx`
2. Use Radix UI primitives if needed
3. Style with Tailwind classes
4. Use `cn()` utility for conditional classes
5. Add variants using `class-variance-authority`

---

## Common Issues and Solutions

### 1. **CORS Errors (Development)**
**Problem:** API requests fail with CORS errors

**Solution:**
- Ensure proxy server is running: `npm run dev:all`
- Check `X-Target-Host` header is set in API client
- Verify `Platform.shouldUseProxy` returns true

### 2. **401 Unauthorized**
**Problem:** API requests return 401

**Solution:**
- Check auth store has valid access token
- Verify profile has credentials stored
- Check token expiration times
- Look for token refresh errors in console

### 3. **Profile Not Loading**
**Problem:** App stuck on loading screen

**Solution:**
- Check browser console for bootstrap errors
- Verify profile store `isInitialized` flag
- Check for timeout in bootstrap process (5s/20s limits)
- Clear localStorage and re-login

### 4. **Images Not Loading**
**Problem:** Monitor streams/event images don't display

**Solution:**
- Check if token is appended to URL
- Verify `cgiUrl` in profile is correct
- Check for CORS issues (use image proxy in dev)
- Verify monitor is online in ZoneMinder

### 5. **Mobile Build Issues**
**Problem:** Capacitor build fails

**Solution:**
- Run `npm run build` first
- Ensure `dist/` directory exists
- Check `capacitor.config.ts` webDir path
- Run `npx cap sync android` or `npx cap sync ios`

---

## Performance Optimizations

1. **Code Splitting**
   - Lazy loaded route components
   - Dynamic imports for large libraries

2. **Image Optimization**
   - Lazy loading images
   - Responsive images (width/height params)
   - Connection key caching

3. **Query Caching**
   - React Query caching
   - Stale-while-revalidate strategy
   - Refetch intervals (e.g., 60s for event counts)

4. **State Optimization**
   - Zustand shallow equality checks
   - Memoized selectors
   - useShallow hook for object selections

5. **Render Optimization**
   - React.memo for expensive components
   - useMemo/useCallback hooks
   - Virtual scrolling for long lists (react-virtual)

---

## Security Considerations

1. **Password Storage**
   - Native Keychain/Keystore on mobile
   - AES-GCM encryption on web
   - Never stored in plain text

2. **Token Management**
   - Access tokens in memory only
   - Refresh tokens persisted encrypted
   - Automatic expiration checking

3. **API Security**
   - Token in query param (ZoneMinder requirement)
   - HTTPS recommended (HTTP allowed)
   - No self-signed cert support

4. **Log Sanitization**
   - Sensitive data removed from logs
   - Passwords masked in debug output
   - Token values truncated

---

## Additional Resources

- **Main README:** `README.md`
- **CHANGELOG:** `CHANGELOG.md`
- **E2E Test Guide:** `app/tests/README.md`
- **ZoneMinder API Docs:** https://zoneminder.readthedocs.io/en/stable/api.html

---

This comprehensive walkthrough should give you everything you need to understand, extend, and maintain this codebase. The architecture is well-structured with clear separation of concerns, strong type safety, and excellent testability.
