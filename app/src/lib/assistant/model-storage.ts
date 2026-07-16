/**
 * On-device model storage info (refs #246)
 *
 * The downloaded model's weights are not a plain file the settings UI can
 * point at: they live in the browser's storage partition for this app, in
 * the Cache API or IndexedDB (see `model-download.ts`'s `buildAppConfig` for
 * the same Cache-API-vs-IndexedDB detection this module reuses). This module
 * collects whatever the platform will actually tell a web page about that
 * storage, for `AssistantSection` to display next to the Delete button.
 */
import { log, LogLevel } from '../logger';

declare global {
  interface Window {
    /** Exposed by the Electron preload bridge (`electron/preload.cjs`) once
     *  the app has been restarted after that bridge was added. Absent on web,
     *  iOS, Android, Tauri, and on an Electron build still running the old
     *  preload script. */
    electronPaths?: {
      getUserDataPath(): Promise<string>;
    };
  }
}

export interface ModelStorageInfo {
  backend: 'cache' | 'indexeddb';
  usageBytes?: number;
  quotaBytes?: number;
  persisted?: boolean;
  osPath?: string;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Formats a byte count as a short human string ("512 KB", "1.3 GB"). The
 *  only other byte formatter in the app (`BackgroundTaskDrawer`'s
 *  `formatBytes`) is a component-local closure, not an exported util (rule
 *  25 covers named constants, not one-off helpers like this). */
export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${BYTE_UNITS[0]}`;
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${BYTE_UNITS[exponent]}`;
}

/** Same feature detection `model-download.ts`'s `buildAppConfig` uses, so the
 *  backend this reports always matches where web-llm actually wrote the
 *  weights. */
function detectBackend(): 'cache' | 'indexeddb' {
  return typeof caches === 'undefined' ? 'indexeddb' : 'cache';
}

/** Best-effort snapshot of what the platform will tell a web page about its
 *  own storage partition. Every probe is independent and optional: a browser
 *  can implement `navigator.storage.estimate()` without `.persisted()`, and
 *  `window.electronPaths` only exists on the Electron build after a restart
 *  past the bridge that adds it. Never throws: a failed probe is omitted from
 *  the result rather than surfaced as an error, since none of this is
 *  essential to using the assistant, only to explaining where its data is. */
export async function getModelStorageInfo(): Promise<ModelStorageInfo> {
  const info: ModelStorageInfo = { backend: detectBackend() };

  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate) {
      info.usageBytes = estimate.usage;
      info.quotaBytes = estimate.quota;
    }
  } catch (error) {
    log.assistant('navigator.storage.estimate() failed', LogLevel.WARN, { error });
  }

  try {
    const persisted = await navigator.storage?.persisted?.();
    if (persisted !== undefined) {
      info.persisted = persisted;
    }
  } catch (error) {
    log.assistant('navigator.storage.persisted() failed', LogLevel.WARN, { error });
  }

  try {
    const osPath = await window.electronPaths?.getUserDataPath?.();
    if (osPath) {
      info.osPath = osPath;
    }
  } catch (error) {
    log.assistant('electronPaths.getUserDataPath() failed', LogLevel.WARN, { error });
  }

  return info;
}
