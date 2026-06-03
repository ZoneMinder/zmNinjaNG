/**
 * App Version Utility
 *
 * Provides a centralized way to access the application version from package.json.
 * Ensures version is never hardcoded throughout the application.
 */

import packageJson from '../../package.json';

// Injected at build time by vite.config.ts (git commit count). Defined as a
// compile-time constant, so guard with typeof for environments without it.
declare const __BUILD_NUMBER__: string | undefined;

/**
 * Get the application version from package.json
 *
 * @returns Version string (e.g., "1.0.0")
 */
export function getAppVersion(): string {
  return packageJson.version;
}

/**
 * Get the monotonic build number injected at build time.
 *
 * Derived from the git commit count. Increases on every commit, independent of
 * the marketing version, so two builds sharing a version are distinguishable.
 *
 * @returns Build number string (e.g., "1509"), or "dev" if not injected
 */
export function getBuildNumber(): string {
  return typeof __BUILD_NUMBER__ !== 'undefined' ? __BUILD_NUMBER__ : 'dev';
}

/**
 * Get the version and build number combined for display.
 *
 * @returns Combined string (e.g., "1.1.14 (1509)")
 */
export function getFullVersion(): string {
  return `${getAppVersion()} (${getBuildNumber()})`;
}

