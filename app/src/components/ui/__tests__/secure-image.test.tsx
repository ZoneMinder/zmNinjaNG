/**
 * SecureImage per-profile client threading (refs #337).
 *
 * The native fallback fetch (used when the plain <img> load fails, e.g. an
 * authenticated resource on native) reads its ApiClient from the session
 * registry. An All-mode thumbnail owned by profile B must fetch through B's
 * client, not whatever profile happens to be globally current.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { SecureImage } from '../secure-image';
import { asProfileId } from '../../../api/types';
import type { ApiClient } from '../../../api/client';
import { seedProfiles, resetProfileFixture } from '../../../tests/profile-fixture';
import { installApiClient, resetFakeStoreGates } from '../../../tests/fake-store-gates';

vi.mock('../../../lib/platform', () => ({
  Platform: { isNative: true },
}));

vi.mock('../../../lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/logger')>();
  return { ...actual, log: { ...actual.log, secureImage: vi.fn() } };
});

const currentClientGet = vi.fn();
const profileBClientGet = vi.fn();

function fakeClient(get: typeof currentClientGet): ApiClient {
  return {
    get,
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    postForm: vi.fn(),
    putForm: vi.fn(),
  } as unknown as ApiClient;
}

const SRC = 'https://zm.example.com/index.php?view=image&eid=1&fid=snapshot';

describe('SecureImage profile threading', () => {
  beforeEach(() => {
    currentClientGet.mockReset().mockResolvedValue({
      data: 'AAAA',
      headers: { 'content-type': 'image/jpeg' },
    });
    profileBClientGet.mockReset().mockResolvedValue({
      data: 'BBBB',
      headers: { 'content-type': 'image/jpeg' },
    });
    // 'profile-missing' is deliberately never seeded: the real session
    // registry throws "unknown profile" for it, same as the old mock did.
    seedProfiles(['current', 'profile-b'], { current: 'current' });
    installApiClient(asProfileId('current'), fakeClient(currentClientGet));
    installApiClient(asProfileId('profile-b'), fakeClient(profileBClientGet));
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('fetches via the current profile client when no profileId is given', async () => {
    const { getByAltText } = render(<SecureImage src={SRC} alt="thumb" />);
    fireEvent.error(getByAltText('thumb'));

    await waitFor(() => {
      expect(currentClientGet).toHaveBeenCalledWith(SRC, { responseType: 'base64' });
    });
    expect(profileBClientGet).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(getByAltText('thumb')).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA');
    });
  });

  it('fetches via the given profile client when profileId is provided', async () => {
    const { getByAltText } = render(
      <SecureImage src={SRC} alt="thumb" profileId={asProfileId('profile-b')} />,
    );
    fireEvent.error(getByAltText('thumb'));

    await waitFor(() => {
      expect(profileBClientGet).toHaveBeenCalledWith(SRC, { responseType: 'base64' });
    });
    expect(currentClientGet).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(getByAltText('thumb')).toHaveAttribute('src', 'data:image/jpeg;base64,BBBB');
    });
  });

  it('falls back to fallbackSrc without throwing when profileId names an unknown profile', async () => {
    const { getByAltText } = render(
      <SecureImage
        src={SRC}
        alt="thumb"
        fallbackSrc="https://fallback/img.png"
        profileId={asProfileId('profile-missing')}
      />,
    );
    fireEvent.error(getByAltText('thumb'));

    await waitFor(() => {
      expect(getByAltText('thumb')).toHaveAttribute('src', 'https://fallback/img.png');
    });
  });
});
