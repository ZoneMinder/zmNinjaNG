# Key Libraries

This chapter documents the critical third-party libraries that power zmNg and how they are used.

## UI and Visualization

### react-grid-layout
Used for the **Dashboard** drag-and-drop interface.
- **Usage**: Enables movable, resizable widgets.
- **Key Concepts**: `Layout` objects (x, y, w, h), `ResponsiveGridLayout` for different screen sizes.
- **Gotchas**: Requires careful handling of drag events to prevent conflicts with interactive widget content (see `DashboardWidget.tsx`).
- **Why**: It is the most mature and stable React library for grid-based dashboards with drag-and-drop resizing support.

### vis-timeline & vis-data
Used for the **Timeline View** (`src/pages/Timeline.tsx`).
- **Usage**: Visualizes thousands of events on a zoomable, scrollable timeline.
- **Why**: **Performance**. DOM-based timeline libraries (like most React ones) choke on thousands of event markers. `vis-timeline` uses HTML5 Canvas/efficient DOM diffing to handle large datasets smoothly.
- **Styling**: Custom CSS in `src/styles/timeline.css`.

### video.js
Used for the **Video Player** (`src/components/ui/video-player.tsx`).
- **Usage**: Robust handling of video playback, including HLS and native formatted streams.
- **Plugins**: `videojs-markers` is used for indicating event points on the seek bar.
- **Why**: ZoneMinder streams can be quirky (MJPEG, various MP4 profiles). Native `<video>` tags are often insufficient. video.js provides a unified API and plugin ecosystem to handle these inconsistencies.

### lucide-react
The standard icon set for the application.
- **Usage**: `<IconName className="h-4 w-4" />`
- **Style**: Consistent, clean SVG icons that scale well.

### @radix-ui/*
Headless UI primitives for accessible components.
- **Usage**: Popovers, Dialogs, dropdowns, switches, etc.
- **Styling**: Styled with Tailwind CSS via `shadcn/ui` pattern.
- **Why**: Allows complete styling freedom (unlike Material UI) while ensuring full accessibility (keyboard nav, screen readers) which is hard to build from scratch.

## Data and Logic

### date-fns & date-fns-tz
Date manipulation and formatting.
- **Usage**: Parsing dates, calculating relative times ("5 mins ago"), and timezone conversions.
- **Standard**: All date formatting should use `date-fns`.
- **Why**: Lightweight and immutable compared to Moment.js. Essential for handling ZoneMinder's timezone-aware timestamps correctly.

### react-hook-form & zod
Form handling and validation.
- **Usage**: Profile creation, settings forms.
- **Pattern**: Zod schemas define the data shape and validation rules; react-hook-form handles the state.
- **Why**: Decouples validation logic from UI. Zod schemas can be inferred as TypeScript types, ensuring type safety from form input to API call.

### @tanstack/react-query
Server state management (data fetching).
- **Usage**: Caching API responses, handling loading/error states, infinite scrolling (Events).
- **Key Config**: `staleTime` and `refetchInterval` are tuned for real-time monitoring.
- **Why**: Eliminates manual `useEffect` fetching and global state boilerplate for server data. Handles intricate caching, deduplication, and background updates (critical for a monitoring app) out of the box.

## Mobile and Platform

### @capacitor/*
Native device feature access for iOS and Android.
- **Core**: Platform detection (`isNativePlatform`).
- **Filesystem**: Saving snapshots and logs.
- **PushNotifications**: Handling APNS/FCM tokens for event alerts.
- **Preferences**: Native storage for secure credentials (along with `@aparajita/capacitor-secure-storage`).
- **Why**: Allows building ios/android apps using the same web codebase. We only drop down to native code (plugins) when we need hardware access that the web API doesn't provide.

## Internationalization

### i18next & react-i18next
Translations and localization.
- **Usage**: `const { t } = useTranslation();`
- **Files**: `src/locales/` contains JSON files for each language.
- **Rule**: No hardcoded strings in UI components.
