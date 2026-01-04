# Key Libraries

This chapter documents the critical third-party libraries that power zmNg and how they are used.

## UI and Visualization

### react-grid-layout
Used for the **Dashboard** drag-and-drop interface.
- **Usage**: Enables movable, resizable widgets.
- **Key Concepts**: `Layout` objects (x, y, w, h), `ResponsiveGridLayout` for different screen sizes.
- **Gotchas**: Requires careful handling of drag events to prevent conflicts with interactive widget content (see `DashboardWidget.tsx`).

### vis-timeline & vis-data
Used for the **Timeline View** (`src/pages/Timeline.tsx`).
- **Usage**: Visualizes thousands of events on a zoomable, scrollable timeline.
- **Why**: Performance. It handles large datasets much better than DOM-based implementations.
- **Styling**: Custom CSS in `src/styles/timeline.css`.

### video.js
Used for the **Video Player** (`src/components/ui/video-player.tsx`).
- **Usage**: Robust handling of video playback, including HLS and native formatted streams.
- **Plugins**: `videojs-markers` is used for indicating event points on the seek bar.

### lucide-react
The standard icon set for the application.
- **Usage**: `<IconName className="h-4 w-4" />`
- **Style**: Consistent, clean SVG icons that scale well.

### @radix-ui/*
Headless UI primitives for accessible components.
- **Usage**: Popovers, Dialogs, dropdowns, switches, etc.
- **Styling**: Styled with Tailwind CSS via `shadcn/ui` pattern.

## Data and Logic

### date-fns & date-fns-tz
Date manipulation and formatting.
- **Usage**: Parsing dates, calculating relative times ("5 mins ago"), and timezone conversions.
- **Standard**: All date formatting should use `date-fns`.

### react-hook-form & zod
Form handling and validation.
- **Usage**: Profile creation, settings forms.
- **Pattern**: Zod schemas define the data shape and validation rules; react-hook-form handles the state.

### @tanstack/react-query
Server state management (data fetching).
- **Usage**: Caching API responses, handling loading/error states, infinite scrolling (Events).
- **Key Config**: `staleTime` and `refetchInterval` are tuned for real-time monitoring.

## Mobile and Platform

### @capacitor/*
Native device feature access for iOS and Android.
- **Core**: Platform detection (`isNativePlatform`).
- **Filesystem**: Saving snapshots and logs.
- **PushNotifications**: Handling APNS/FCM tokens for event alerts.
- **Preferences**: Native storage for secure credentials (along with `@aparajita/capacitor-secure-storage`).

## Internationalization

### i18next & react-i18next
Translations and localization.
- **Usage**: `const { t } = useTranslation();`
- **Files**: `src/locales/` contains JSON files for each language.
- **Rule**: No hardcoded strings in UI components.
