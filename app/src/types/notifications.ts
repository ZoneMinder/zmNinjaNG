/**
 * Shared types for ZoneMinder Notifications
 */

export interface ZMEventServerConfig {
    host: string; // e.g., "zm.example.com"
    port: number; // default 9000
    path?: string; // default "/"
    ssl: boolean; // true for wss://, false for ws://
    username: string;
    password: string;
    appVersion: string;
}

/**
 * Store-derived values injected into ZMNotificationService at connect time.
 * The service has no zustand imports; the notification store assembles these.
 */
export interface ZMNotificationProviders {
    /** Returns a fresh ZM access token for image URLs, or null when unavailable. */
    getFreshAccessToken: () => Promise<string | null>;
    /** Builds the snapshot image URL for an event when the server sends no Picture. */
    buildEventImageUrl: (eventId: number, token: string | null) => string | undefined;
    /** WebSocket keepalive ping interval in milliseconds. */
    getKeepaliveIntervalMs: () => number;
}

export interface ZMAlarmEvent {
    MonitorId: number;
    MonitorName: string;
    EventId: number;
    Cause: string;
    Name: string;
    Notes?: string; // Event notes (e.g. "detected:car| Motion: All"). Available from poller, not from websocket/FCM
    DetectionJson?: unknown[];
    Picture?: string; // Server-provided image URL (if include_picture is configured)
    ImageUrl?: string; // URL to event snapshot/alarm frame (server-provided or client-constructed)
}

export interface ZMNotificationMessage {
    event: 'auth' | 'alarm' | 'push' | 'control';
    type: string;
    status: 'Success' | 'Fail';
    reason?: string;
    version?: string;
    events?: ZMAlarmEvent[];
    supplementary?: string;
}

export type ConnectionState =
    | 'disconnected'
    | 'connecting'
    | 'authenticating'
    | 'connected'
    | 'error';

export type NotificationMode = 'es' | 'direct';

export interface MonitorNotificationConfig {
    monitorId: number;
    enabled: boolean;
    checkInterval: number; // Seconds between checks (60, 120, etc.)
}

/** Per-profile notification configuration, persisted by stores/notifications. */
export interface NotificationSettings {
    enabled: boolean;
    notificationMode: NotificationMode; // 'es' = Event Server websocket, 'direct' = ZM REST API
    notificationId: number | null; // Server-side Notifications.Id (direct mode)
    host: string; // Event server host (e.g., "zm.example.com")
    port: number; // Event server port (default 9000)
    ssl: boolean; // Use wss:// instead of ws://
    allMonitors: boolean; // Receive notifications for all monitors (no filter sent to ES)
    monitorFilters: MonitorNotificationConfig[]; // Per-monitor settings (used when allMonitors is false)
    onlyDetectedEvents: boolean; // Only notify for events with object detection results (direct mode)
    pollingInterval: number; // Seconds between event polls in direct mode (desktop)
    showToasts: boolean; // Show toast notifications for events
    playSound: boolean; // Play sound on notification
    badgeCount: number; // Current unread count
}

export type NotificationSource = 'websocket' | 'push' | 'poll';

export type NotificationEventCallback = (event: ZMAlarmEvent) => void;
export type ConnectionStateCallback = (state: ConnectionState) => void;
