/**
 * SecureImage per-profile client threading (refs #337).
 *
 * The native fallback fetch (used when the plain <img> load fails, e.g. an
 * authenticated resource on native) reads its ApiClient from the session
 * registry. An All-mode thumbnail owned by profile B must fetch through B's
 * client, not whatever profile happens to be globally current.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { SecureImage } from '../secure-image';
import { asProfileId } from '../../../api/types';

vi.mock('../../../lib/platform', () => ({
  Platform: { isNative: true },
}));

vi.mock('../../../lib/logger', () => ({
  log: { secureImage: vi.fn() },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
}));

const currentClientGet = vi.fn();
const profileBClientGet = vi.fn();

vi.mock('../../../services/sessions', () => ({
  getCurrentSession: vi.fn(() => ({ client: { get: currentClientGet } })),
  getSession: vi.fn((profileId: string) => {
    if (profileId === 'profile-b') return { client: { get: profileBClientGet } };
    throw new Error(`getSession: unknown profile ${profileId}`);
  }),
}));

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
