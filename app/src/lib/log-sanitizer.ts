/**
 * Utility functions for sanitizing sensitive data in logs
 */

import { maskUrlCredentials } from './security/url-credentials';

/** Matches a bare IP or hostname, as opposed to one inside a URL. */
const IP_OR_DOMAIN_PATTERN = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|[a-zA-Z0-9][\w.-]*\.[a-zA-Z]{2,})$/;

/**
 * Redaction gate, injected instead of importing stores/profile and
 * stores/settings directly. Without this, lib/logger -> lib/log-sanitizer ->
 * stores/profile forms a static import cycle back to lib/logger (every
 * store/service imports the logger). stores/profile.ts assembles the real
 * gate from both stores and registers it here at module load. Refs #217.
 */
export interface LogRedactionGate {
  isRedactionDisabled(): boolean;
}

let redactionGate: LogRedactionGate = {
  // Safe default before the store registers: never suppress redaction.
  isRedactionDisabled: () => false,
};

export function setLogRedactionGate(gate: LogRedactionGate): void {
  redactionGate = gate;
}

const SENSITIVE_KEYS = [
    'password',
    'pass',
    'pwd',
    'secret',
    'credential',
    // The ZoneMinder session lives in the ZMSESSID cookie, and the HTTP client
    // logs request and response headers (refs #307). 'auth' below covers the
    // Authorization header; nothing covered Cookie/Set-Cookie.
    'cookie',
    'token',
    'accessToken',
    'refreshToken',
    'access_token',
    'refresh_token',
    'apiKey',
    'api_key',
    // Covers the 'x-api-key' header (refs #246, OpenAI-compatible/Ollama
    // adapter): 'authorization' below already matches the 'Authorization'
    // header, but that key's hyphen means it doesn't match 'apikey'/'api_key'.
    'api-key',
    'authorization',
    'auth',
];

// Whitelist of keys that should NEVER be sanitized, even if they look like sensitive data
// or if we want to preserve them for debugging
const WHITELIST_KEYS = [
    'event',
    'events',
    'status',
    'reason',
    'type',
    'monitor',
    'MonitorName',
    'Cause',
    'Name',
    'DetectionJson',
    'ImageUrl',
    'fullMessage',
    'message'
];

/**
 * Keys whose value is replaced outright rather than previewed. A token's first
 * few characters help correlate two log lines; a password's help an attacker.
 */
const FULL_REDACT_KEYS = ['password', 'pass', 'pwd', 'secret', 'credential'];

function isFullRedactKey(lowerKey: string): boolean {
    return FULL_REDACT_KEYS.some(k => lowerKey.includes(k));
}

/**
 * Redacts password fields completely
 */
function redactPassword(_value: unknown): string {
    return '[REDACTED]';
}

/**
 * Shows first 5 characters of tokens followed by ...
 */
function redactToken(value: unknown): string {
    const str = String(value);
    if (str.length <= 5) return '[REDACTED]';
    return `${str.substring(0, 5)}...`;
}

/**
 * Sanitizes URL-encoded form data (e.g., "user=demo&pass=demo")
 */
function sanitizeFormData(data: string): string {
    try {
        const params = new URLSearchParams(data);
        const sanitized = new URLSearchParams();

        params.forEach((value, key) => {
            const lowerKey = key.toLowerCase();
            if (SENSITIVE_KEYS.some(sk => lowerKey.includes(sk))) {
                if (isFullRedactKey(lowerKey)) {
                    sanitized.set(key, '[REDACTED]');
                } else {
                    sanitized.set(key, value.length > 5 ? `${value.substring(0, 5)}...` : '[REDACTED]');
                }
            } else {
                sanitized.set(key, value);
            }
        });

        return sanitized.toString();
    } catch {
        return data;
    }
}

/**
 * Redacts URL host, keeping only scheme and first 6 characters of domain
 * Example: https://example.com/path -> https://exampl[REDACTED]
 */
function redactUrlHost(url: string): string {
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        const redactedDomain = domain.length > 6 ? `${domain.substring(0, 6)}[REDACTED]` : '[REDACTED]';
        return `${urlObj.protocol}//${redactedDomain}`;
    } catch {
        // Not a valid URL, check if it looks like an IP or domain
        if (IP_OR_DOMAIN_PATTERN.test(url)) {
            return url.length > 6 ? `${url.substring(0, 6)}[REDACTED]` : '[REDACTED]';
        }
        return url;
    }
}

/**
 * Sanitizes URLs by redacting the host portion
 */
function sanitizeUrl(url: string): string {
    try {
        const urlObj = new URL(url);

        // Redact host - keep first 6 characters
        const domain = urlObj.hostname;
        const redactedDomain = domain.length > 6 ? `${domain.substring(0, 6)}[REDACTED]` : '[REDACTED]';

        // Reconstruct URL with redacted hostname but preserve everything else
        let result = `${urlObj.protocol}//${redactedDomain}`;

        // Add port if present
        if (urlObj.port) {
            result += `:${urlObj.port}`;
        }

        // Add pathname
        result += urlObj.pathname;

        // Redact basic auth password if present
        if (urlObj.username) {
            const auth = urlObj.password ? `${urlObj.username}:[REDACTED]` : urlObj.username;
            result = `${urlObj.protocol}//${auth}@${redactedDomain}${urlObj.port ? ':' + urlObj.port : ''}${urlObj.pathname}`;
        }

        // Handle query parameters - redact sensitive ones
        if (urlObj.search) {
            const params = new URLSearchParams(urlObj.search);
            const sanitizedParams = new URLSearchParams();

            params.forEach((value, key) => {
                const lowerKey = key.toLowerCase();
                if (SENSITIVE_KEYS.some(sk => lowerKey.includes(sk))) {
                    if (isFullRedactKey(lowerKey)) {
                        sanitizedParams.set(key, '[REDACTED]');
                    } else {
                        sanitizedParams.set(key, value.length > 5 ? `${value.substring(0, 5)}...` : '[REDACTED]');
                    }
                } else {
                    sanitizedParams.set(key, value);
                }
            });

            const queryString = sanitizedParams.toString();
            if (queryString) {
                result += `?${queryString}`;
            }
        }

        // Add hash if present
        if (urlObj.hash) {
            result += urlObj.hash;
        }

        return result;
    } catch {
        // Not a valid URL, return as-is
        return url;
    }
}

/**
 * Helper to check if log redaction is disabled for the current profile
 */
function isRedactionDisabled(): boolean {
    try {
        return redactionGate.isRedactionDisabled();
    } catch {
        // Ignore errors accessing the gate (e.g. during initialization)
    }
    return false;
}

/**
 * Sanitizes one string value, wherever it appears: a bare argument, an object
 * value, or a nested one. Both callers used to carry their own copy of these
 * checks, and the copies drifted (refs #307).
 *
 * Order matters. Userinfo credentials go first because they are scheme-blind
 * and can sit anywhere in the string, including inside an ffmpeg option list
 * that is not a URL at all. The URL check comes before the form-data check so a
 * query string with a password in it is redacted as a URL and stays readable,
 * rather than being percent-encoded into one flat blob.
 */
function sanitizeString(value: string): string {
    const text = maskUrlCredentials(value, '[REDACTED]');

    if (text.startsWith('http://') || text.startsWith('https://')) {
        return sanitizeUrl(text);
    }

    // URL-encoded form data. A single-field body ('pass=secret') has no '&' to
    // key off, so the presence of a sensitive key is the whole test.
    if (text.includes('=')) {
        const hasSensitive = SENSITIVE_KEYS.some(sk =>
            new RegExp(`[?&]${sk}=`, 'i').test(text) || text.toLowerCase().startsWith(`${sk}=`)
        );
        if (hasSensitive) {
            return sanitizeFormData(text);
        }
    }

    if (IP_OR_DOMAIN_PATTERN.test(text)) {
        return redactUrlHost(text);
    }

    return text;
}

/**
 * Recursively sanitizes an object by redacting sensitive fields
 */
export function sanitizeObject(obj: unknown): unknown {
    // Check if redaction is disabled in settings for current profile
    if (isRedactionDisabled()) {
        return obj;
    }

    if (obj === null || obj === undefined) {
        return obj;
    }

    if (typeof obj === 'string') {
        return sanitizeString(obj);
    }

    if (typeof obj !== 'object') {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
    }

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
        // Whitelisted keys are not themselves treated as sensitive, but we still
        // recurse so nested sensitive fields (e.g. a password inside a `message`
        // object) are redacted. The recursive call respects the redaction setting,
        // so when redaction is disabled the value is returned unchanged.
        if (WHITELIST_KEYS.includes(key)) {
            sanitized[key] = sanitizeObject(value);
            continue;
        }

        const lowerKey = key.toLowerCase();

        // A sensitive key holding an object is a container, not the secret
        // itself ('credentials: { password }'), so recurse into it rather than
        // stringifying it to '[obje...'.
        const isSensitive =
            SENSITIVE_KEYS.some(sk => lowerKey.includes(sk)) &&
            (typeof value !== 'object' || value === null);

        if (isSensitive) {
            sanitized[key] = isFullRedactKey(lowerKey) ? redactPassword(value) : redactToken(value);
        } else if (typeof value === 'string') {
            sanitized[key] = sanitizeString(value);
        } else if (typeof value === 'object' && value !== null) {
            // Recursively sanitize nested objects
            sanitized[key] = sanitizeObject(value);
        } else {
            sanitized[key] = value;
        }
    }

    return sanitized;
}

/**
 * Sanitizes a log message by redacting sensitive information
 */
export function sanitizeLogMessage(message: string): string {
    // Check if redaction is disabled
    if (isRedactionDisabled()) {
        return message;
    }

    // Userinfo credentials first: they appear under schemes the URL pass below
    // never looks at (rtsp://, rtmp://), which is how a camera password used to
    // reach the log intact (refs #307).
    const withoutCredentials = maskUrlCredentials(message, '[REDACTED]');

    // Only sanitize complete URLs in the message
    // Don't try to sanitize standalone IPs/domains as they might be part of paths
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    return withoutCredentials.replace(urlPattern, (url) => sanitizeUrl(url));
}

/**
 * Sanitizes log arguments (can be any type)
 */
export function sanitizeLogArgs(args: unknown[]): unknown[] {
    return args.map(arg => sanitizeObject(arg));
}
