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
    Notes?: string; // Event notes (e.g. "detected:car| Motion: All") — available from poller, not from websocket/FCM
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

export type NotificationEventCallback = (event: ZMAlarmEvent) => void;
export type ConnectionStateCallback = (state: ConnectionState) => void;
