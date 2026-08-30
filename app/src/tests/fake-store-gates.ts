/**
 * Drop-in for `api/store-gates` in tests, so the REAL session registry builds
 * REAL sessions whose client is a fake you script per test.
 *
 * Usage, at the top of a test file (vi.mock is hoisted, so it cannot live in
 * a helper):
 *
 *   vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
 *
 * Then `seedProfiles(...)` from `profile-fixture` and `installApiClient(...)`
 * to script responses. Everything above `api/*` (stores, hooks, services,
 * components) runs for real, which is the testing playbook's rule: mock the
 * system boundary, not the app.
 */
import { vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { ProfileId } from '../api/types';
import { fakeApiClient } from './fake-api-client';

const clients = new Map<ProfileId, ApiClient>();
let fallback: ApiClient = fakeApiClient();

/** Script the client a profile's session will use. Call before the first getSession. */
export function installApiClient(profileId: ProfileId, client: ApiClient): void {
  clients.set(profileId, client);
}

/** Client for any profile without one installed. */
export function installDefaultApiClient(client: ApiClient): void {
  fallback = client;
}

export function resetFakeStoreGates(): void {
  clients.clear();
  fallback = fakeApiClient();
}

export const createStoreApiClient = vi.fn(
  (_baseURL: string, _reLogin: unknown, profileId: ProfileId): ApiClient =>
    clients.get(profileId) ?? fallback,
);
export const resetAuthGates = vi.fn();
export const makeProfileGates = vi.fn(() => ({}));
