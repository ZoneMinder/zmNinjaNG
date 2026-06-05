import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Layout, Layouts } from 'react-grid-layout';
import { LogLevel } from '../lib/log-level';
import type { BandwidthMode } from '../lib/zmninja-ng-constants';

export type ViewMode = 'snapshot' | 'streaming';
export type DisplayMode = 'normal' | 'compact';
export type MonitorFeedFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
export type MonitorsLayoutMode = MonitorFeedFit | 'flex';
export type MonitorsViewMode = 'list' | 'grid';
export type EventsViewMode = 'list' | 'montage';
export type ThemePreference = 'amber' | 'cream' | 'dark' | 'light' | 'slate' | 'system';
export type StreamingMethod = 'auto' | 'mjpeg';
export type WebRTCProtocol = 'webrtc' | 'mse' | 'hls';
export type DateFormatPreset = 'MMM d, yyyy' | 'MMM d' | 'dd/MM/yyyy' | 'dd/MM' | 'custom';
export type TimeFormatPreset = '12h' | '24h' | 'custom';
export type ThumbnailFallbackType = 'alarm' | 'snapshot' | 'objdetect' | 'custom';

export interface ThumbnailFallbackEntry {
  type: ThumbnailFallbackType;
  enabled: boolean;
  customFid?: string;
}

export interface HoverPreviewSettings {
  eventsList: boolean;
  eventsGrid: boolean;
  monitorsList: boolean;
  monitorsGrid: boolean;
  dashboard: boolean;
  timeline: boolean;
  notifications: boolean;
}

export const DEFAULT_HOVER_PREVIEW: HoverPreviewSettings = {
  eventsList: true,
  eventsGrid: false,
  monitorsList: true,
  monitorsGrid: false,
  dashboard: true,
  timeline: true,
  notifications: true,
};

/** ZMS rate parameter (percentage). 100 = 1x real time. */
export type HoverPreviewPlaybackRate = 50 | 100 | 150 | 200 | 400;

export const HOVER_PREVIEW_PLAYBACK_RATES: readonly HoverPreviewPlaybackRate[] = [50, 100, 150, 200, 400] as const;

export const DEFAULT_HOVER_PREVIEW_PLAYBACK_RATE: HoverPreviewPlaybackRate = 200;

export const DEFAULT_THUMBNAIL_FALLBACK_CHAIN: ThumbnailFallbackEntry[] = [
  { type: 'alarm', enabled: true },
  { type: 'snapshot', enabled: true },
  { type: 'objdetect', enabled: true },
  { type: 'custom', enabled: false, customFid: '' },
];

/** Sentinel group key for the "no group / All monitors" montage bucket. */
export const ALL_GROUPS_KEY = '__all__';

export interface MontageSavedLayout {
  name: string;
  layout: Layout[];
  displayCols: number;
}

/** Per-group live montage state. Keyed by group ID or ALL_GROUPS_KEY. */
export interface MontageGroupLayout {
  workingLayout: Layout[];
  savedLayouts: MontageSavedLayout[];
  activeLayoutName: string | null;
  gridCols: number;
  hiddenMonitorIds: string[];
}

/** Per-group event montage state. Event montage is a uniform grid, so only the
 * column count needs scoping. */
export interface EventMontageGroupLayout {
  gridCols: number;
}

export const DEFAULT_MONTAGE_GROUP_LAYOUT: MontageGroupLayout = {
  workingLayout: [],
  savedLayouts: [],
  activeLayoutName: null,
  gridCols: 2,
  hiddenMonitorIds: [],
};

export const DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT: EventMontageGroupLayout = {
  gridCols: 2,
};

export interface ProfileSettings {
  viewMode: ViewMode;
  displayMode: DisplayMode;
  theme: ThemePreference;
  logLevel: LogLevel;
  snapshotRefreshInterval: number; // in seconds
  streamMaxFps: number; // Max FPS for live streams
  streamScale: number; // Scale percentage for live streams (1-100)
  defaultEventLimit: number; // Default number of events to fetch when no filters applied
  dashboardRefreshInterval: number; // in seconds, for dashboard widgets (events/timeline)
  // Per-group live montage layout state. Key = group ID or ALL_GROUPS_KEY.
  montageByGroup: Record<string, MontageGroupLayout>;
  // Per-group event montage state (column count). Key = group ID or ALL_GROUPS_KEY.
  eventMontageByGroup: Record<string, EventMontageGroupLayout>;
  montageIsFullscreen: boolean; // Fullscreen state for Montage page
  montageFeedFit: MonitorFeedFit; // Object-fit for montage feeds
  montageShowToolbar: boolean; // Show/hide montage toolbar row
  eventsViewMode: EventsViewMode; // List vs montage view for Events page
  monitorsFeedFit: MonitorsLayoutMode; // Layout mode for monitor list
  monitorsViewMode: MonitorsViewMode; // List or grid view
  monitorGridCols: number; // Grid columns for Monitors page grid view
  monitorDetailFeedFit: MonitorFeedFit; // Object-fit for monitor detail feed
  eventsThumbnailFit: MonitorFeedFit; // Object-fit for event thumbnails
  monitorDetailCycleSeconds: number; // Auto-cycle interval for single monitor view (0 = off)
  insomnia: boolean; // Global: Keep screen awake across all pages
  monitorDetailInsomnia: boolean; // @deprecated - use global insomnia instead
  montageInsomnia: boolean; // @deprecated - use global insomnia instead
  eventMontageFilters: {
    monitorIds: string[];
    cause: string;
    startDate: string;
    endDate: string;
  };
  eventsPageFilters: {
    monitorIds: string[];
    tagIds: string[];
    startDateTime: string;
    endDateTime: string;
    favoritesOnly: boolean;
    onlyDetectedObjects: boolean;
    activeQuickRange: number | null;
  };
  disableLogRedaction: boolean;
  lastRoute: string; // Last visited route for this profile
  // Streaming method: 'auto' tries WebRTC/MSE/HLS for Go2RTC-enabled monitors, 'mjpeg' forces MJPEG for all
  streamingMethod: StreamingMethod;
  // Whether to enable fallback from WebRTC to MSE to HLS when protocols fail
  webrtcFallbackEnabled: boolean;
  // Which protocols to try for WebRTC streaming (video-rtc runs them in parallel)
  webrtcProtocols: WebRTCProtocol[];
  // Bandwidth mode: 'normal' for default intervals, 'low' for reduced bandwidth usage
  bandwidthMode: BandwidthMode;
  // Selected group ID for filtering monitors (null = show all monitors)
  selectedGroupId: string | null;
  // Monitor IDs excluded from this profile. Excluded monitors and their events
  // are dropped at the API boundary so they behave as if they don't exist.
  excludedMonitorIds: string[];
  // Allow self-signed HTTPS certificates for this profile's server
  allowSelfSignedCerts: boolean;
  // SHA-256 fingerprint of the trusted TLS certificate (TOFU pinning)
  trustedCertFingerprint: string | null;
  // Custom sidebar nav order (array of route paths). Empty = default order.
  sidebarNavOrder: string[];
  // Timeline page persisted filters
  timelinePageFilters: {
    monitorIds: string[];
    startDateTime: string;
    endDateTime: string;
    onlyDetectedObjects: boolean;
    causeFilter: string;
    activeQuickRange: number | null;
  };
  // Date/time display format
  dateFormat: DateFormatPreset;
  timeFormat: TimeFormatPreset;
  customDateFormat: string; // used when dateFormat === 'custom'
  customTimeFormat: string; // used when timeFormat === 'custom'
  // Auto-play video when opening event detail
  eventVideoAutoplay: boolean;
  // Desktop sidebar width in pixels (60–320, persisted across sessions)
  sidebarWidth: number;
  // TV mode — enables D-pad navigation and larger UI
  tvMode: boolean;
  // Show protocol label (MJPEG/MSE/WebRTC) on video streams
  showProtocolLabel: boolean;
  // Per-monitor streaming method overrides (monitorId → 'auto' | 'mjpeg')
  // When absent, the monitor uses the profile-level streamingMethod.
  monitorStreamingOverrides: Record<string, StreamingMethod>;
  // Force-disable multi-port streaming. When true, the app ignores the server's
  // ZM_MIN_STREAMING_PORT and uses the portal's default port for all streams.
  // Default false = auto (use the server config when present).
  forceDisableMultiPort: boolean;
  // Per-component log level overrides (component name → LogLevel)
  // When absent, the component uses the global logLevel.
  componentLogLevels: Record<string, number>;
  // Ordered fallback chain for event thumbnails. Disabled entries (and custom
  // entries with an empty customFid) are skipped at URL build time.
  thumbnailFallbackChain: ThumbnailFallbackEntry[];
  // Hover preview toggles for events/monitors/dashboard/timeline
  hoverPreview: HoverPreviewSettings;
  // Playback speed for event hover/longpress preview (ZMS rate percentage).
  // Only affects EventZmsHoverPlayer; live monitor previews are real-time.
  hoverPreviewPlaybackRate: HoverPreviewPlaybackRate;
}

interface SettingsState {
  // Settings per profile ID
  profileSettings: Record<string, ProfileSettings>;

  // Get settings for a specific profile (with defaults)
  getProfileSettings: (profileId: string) => ProfileSettings;

  // Update settings for a specific profile
  updateProfileSettings: (profileId: string, updates: Partial<ProfileSettings>) => void;

  // Merge a patch into a group's montage bucket
  updateMontageGroupLayout: (
    profileId: string,
    groupKey: string,
    patch: Partial<MontageGroupLayout>
  ) => void;

  // Merge a patch into a group's event montage bucket
  updateEventMontageGroupLayout: (
    profileId: string,
    groupKey: string,
    patch: Partial<EventMontageGroupLayout>
  ) => void;
}

// Compact is the default for all devices
const getDefaultDisplayMode = (): DisplayMode => {
  return 'compact';
};

const getDefaultLogLevel = (): LogLevel => (
  typeof import.meta !== 'undefined' && import.meta.env?.DEV ? LogLevel.DEBUG : LogLevel.INFO
);

export const getDefaultViewMode = (): ViewMode => 'snapshot';

export const DEFAULT_SETTINGS: ProfileSettings = {
  viewMode: getDefaultViewMode(),
  displayMode: getDefaultDisplayMode(),
  theme: 'slate',
  logLevel: getDefaultLogLevel(),
  snapshotRefreshInterval: 3,
  streamMaxFps: 10,
  streamScale: 50,
  defaultEventLimit: 100,
  dashboardRefreshInterval: 30,
  montageByGroup: {},
  eventMontageByGroup: {},
  montageIsFullscreen: false,
  montageFeedFit: 'cover',
  montageShowToolbar: true,
  eventsViewMode: 'list',
  monitorsFeedFit: 'contain',
  monitorsViewMode: 'list' as const,
  monitorGridCols: 2,
  monitorDetailFeedFit: 'contain',
  eventsThumbnailFit: 'contain',
  monitorDetailCycleSeconds: 0,
  insomnia: false,
  monitorDetailInsomnia: false,
  montageInsomnia: false,
  eventMontageFilters: {
    monitorIds: [],
    cause: 'all',
    startDate: '',
    endDate: '',
  },
  eventsPageFilters: {
    monitorIds: [],
    tagIds: [],
    startDateTime: '',
    endDateTime: '',
    favoritesOnly: false,
    onlyDetectedObjects: false,
    activeQuickRange: null,
  },
  disableLogRedaction: false,
  lastRoute: '/monitors',
  // Auto mode: use WebRTC/MSE/HLS for Go2RTC-enabled monitors, MJPEG for others
  streamingMethod: 'auto',
  // Enable fallback through protocols when one fails
  webrtcFallbackEnabled: true,
  // Default: try all protocols (video-rtc runs them in parallel, first to produce video wins)
  webrtcProtocols: ['webrtc', 'mse', 'hls'],
  // Normal bandwidth mode by default
  bandwidthMode: 'normal',
  // No group filter by default (show all monitors)
  selectedGroupId: null,
  // No monitors excluded by default
  excludedMonitorIds: [],
  // Self-signed certs disabled by default (secure default)
  allowSelfSignedCerts: false,
  // No pinned certificate by default
  trustedCertFingerprint: null,
  // Default sidebar order (empty = use hardcoded order)
  sidebarNavOrder: [],
 timelinePageFilters: {
    monitorIds: [],
    startDateTime: '',
    endDateTime: '',
    onlyDetectedObjects: false,
    causeFilter: '',
    activeQuickRange: null,
  },
  dateFormat: 'MMM d',
  timeFormat: '12h',
  customDateFormat: 'EEE, MMM d yyyy',
  customTimeFormat: 'h:mm:ss a',
  eventVideoAutoplay: true,
  sidebarWidth: 256,
  tvMode: false,
  showProtocolLabel: true,
  monitorStreamingOverrides: {},
  // Auto by default: honor the server's ZM_MIN_STREAMING_PORT when present
  forceDisableMultiPort: false,
  componentLogLevels: {},
  thumbnailFallbackChain: DEFAULT_THUMBNAIL_FALLBACK_CHAIN,
  hoverPreview: DEFAULT_HOVER_PREVIEW,
  hoverPreviewPlaybackRate: DEFAULT_HOVER_PREVIEW_PLAYBACK_RATE,
};

/** Migrate persisted settings from v0 (flat montage fields) to v1 (group-keyed maps). */
export function migrateSettings(persistedState: unknown, version: number): unknown {
  if (version >= 1) return persistedState;
  const state = (persistedState ?? {}) as { profileSettings?: Record<string, unknown> };
  const profileSettings = state.profileSettings ?? {};
  const migrated: Record<string, unknown> = {};

  for (const [profileId, raw] of Object.entries(profileSettings)) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const {
      montageLayouts,
      montageSavedLayouts,
      montageActiveLayoutName,
      montageGridCols,
      montageGridRows: _montageGridRows,
      montageHiddenMonitorIds,
      eventMontageGridCols,
      eventMontageLayouts: _eventMontageLayouts,
      ...rest
    } = s;

    const lgLayout = (montageLayouts as Layouts | undefined)?.lg ?? [];

    migrated[profileId] = {
      ...rest,
      montageByGroup: {
        [ALL_GROUPS_KEY]: {
          workingLayout: lgLayout,
          savedLayouts: (montageSavedLayouts as MontageSavedLayout[] | undefined) ?? [],
          activeLayoutName: (montageActiveLayoutName as string | null | undefined) ?? null,
          gridCols: (montageGridCols as number | undefined) ?? DEFAULT_MONTAGE_GROUP_LAYOUT.gridCols,
          hiddenMonitorIds: (montageHiddenMonitorIds as string[] | undefined) ?? [],
        },
      },
      eventMontageByGroup: {
        [ALL_GROUPS_KEY]: {
          gridCols:
            (eventMontageGridCols as number | undefined) ??
            DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT.gridCols,
        },
      },
    };
  }

  return { ...state, profileSettings: migrated };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      profileSettings: {},

      getProfileSettings: (profileId) => {
        const settings = get().profileSettings[profileId];
        return { ...DEFAULT_SETTINGS, ...settings };
      },

      updateProfileSettings: (profileId, updates) => {
        set((state) => ({
          profileSettings: {
            ...state.profileSettings,
            [profileId]: {
              ...(state.profileSettings[profileId] || DEFAULT_SETTINGS),
              ...updates,
            },
          },
        }));
      },

      updateMontageGroupLayout: (profileId, groupKey, patch) => {
        set((state) => {
          const profile = state.profileSettings[profileId] || DEFAULT_SETTINGS;
          const bucket = profile.montageByGroup?.[groupKey] || DEFAULT_MONTAGE_GROUP_LAYOUT;
          return {
            profileSettings: {
              ...state.profileSettings,
              [profileId]: {
                ...profile,
                montageByGroup: {
                  ...profile.montageByGroup,
                  [groupKey]: { ...bucket, ...patch },
                },
              },
            },
          };
        });
      },

      updateEventMontageGroupLayout: (profileId, groupKey, patch) => {
        set((state) => {
          const profile = state.profileSettings[profileId] || DEFAULT_SETTINGS;
          const bucket =
            profile.eventMontageByGroup?.[groupKey] || DEFAULT_EVENT_MONTAGE_GROUP_LAYOUT;
          return {
            profileSettings: {
              ...state.profileSettings,
              [profileId]: {
                ...profile,
                eventMontageByGroup: {
                  ...profile.eventMontageByGroup,
                  [groupKey]: { ...bucket, ...patch },
                },
              },
            },
          };
        });
      },
    }),
    {
      name: 'zmng-settings',
      version: 1,
      migrate: migrateSettings,
    }
  )
);
