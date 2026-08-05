/**
 * ProfileSwitcher real-store regression test (refs #337).
 *
 * The isolated switcher test mocks the store as `(selector) => selector(state)`
 * AND mocks useShallow to identity, so it is blind to the failure mode a new
 * subscription risks: a selector minting a fresh array each call loops the
 * render through useSyncExternalStore. The group list added here is that
 * shape, so this renders against the REAL store and asserts the trigger's
 * text, which follows the group through a rename.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ProfileSwitcher } from '../profile-switcher';
import { useProfileStore } from '../../stores/profile';
import { asProfileId } from '../../api/types';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../api/store-gates', () => ({
  createStoreApiClient: vi.fn(() => ({ mock: true })),
  resetAuthGates: vi.fn(),
}));
vi.mock('../../lib/security/secureStorage', () => ({
  setSecureValue: vi.fn(),
  getSecureValue: vi.fn(),
  removeSecureValue: vi.fn(),
}));

const server = (id: string, name: string) => ({
  id: asProfileId(id),
  name,
  apiUrl: `http://${id}`,
  portalUrl: `http://${id}`,
  cgiUrl: `http://${id}/cgi-bin`,
  isDefault: false,
  createdAt: 1,
});

describe('ProfileSwitcher against the real store', () => {
  beforeEach(() => {
    useProfileStore.setState({
      profiles: [server('p1', 'Home'), server('p2', 'Away')],
      virtualProfiles: [],
      currentProfileId: asProfileId('p1'),
      isInitialized: true,
    });
  });

  it('names the current group on the trigger and follows a rename', () => {
    const id = useProfileStore.getState().addVirtualProfile('Upstairs', [asProfileId('p1')]);
    useProfileStore.setState({ currentProfileId: id });

    render(<ProfileSwitcher />);
    expect(screen.getByTestId('profile-switcher-trigger')).toHaveTextContent('Upstairs');

    act(() => useProfileStore.getState().updateVirtualProfile(id, { name: 'Attic' }));

    expect(screen.getByTestId('profile-switcher-trigger')).toHaveTextContent('Attic');
  });
});
