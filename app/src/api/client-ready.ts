/**
 * Tracks whether the API client singleton has been created.
 *
 * Kept in its own module with no imports so that stores/auth can read it
 * synchronously without forming an auth <-> api/client load cycle (client.ts
 * imports the auth store, so auth must not import client.ts at module scope).
 * api/client.ts owns the actual singleton and updates this flag from
 * setApiClient/resetApiClient.
 */

let initialized = false;

export function setApiClientInitialized(value: boolean): void {
  initialized = value;
}

export function isApiClientInitialized(): boolean {
  return initialized;
}
