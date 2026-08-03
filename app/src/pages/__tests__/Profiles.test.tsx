import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Profiles from '../Profiles';
import { ALL_PROFILES_ID } from '../../api/types';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const useCurrentProfileMock = vi.fn();
vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => useCurrentProfileMock(),
}));

vi.mock('../../stores/settings', () => ({
  DEFAULT_SETTINGS: {
    viewMode: 'snapshot',
    displayMode: 'normal',
    theme: 'light',
  },
  useSettingsStore: vi.fn((selector: any) => {
    if (typeof selector === 'function') {
      return selector({ profileSettings: {} });
    }
    return {};
  }),
}));

const switchProfileMock = vi.fn(() => Promise.resolve());
const useProfileStoreMock = vi.fn();
vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: any) => unknown) => selector(useProfileStoreMock()),
}));

vi.mock('../../hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('../../services/discovery', () => ({
  discoverZoneminder: vi.fn(),
  DiscoveryError: class DiscoveryError extends Error {},
}));

vi.mock('sonner', () => ({
  toast: {
    dismiss: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

const HOME = {
  id: 'p1',
  name: 'Home',
  portalUrl: 'https://home.test',
  apiUrl: 'https://api.home.test',
  cgiUrl: 'https://home.test/cgi-bin',
  isDefault: true,
  createdAt: 1,
};

const OFFICE = {
  id: 'p2',
  name: 'Office',
  portalUrl: 'https://office.test',
  apiUrl: 'https://api.office.test',
  cgiUrl: 'https://office.test/cgi-bin',
  isDefault: false,
  createdAt: 2,
};

function storeState(profiles: typeof HOME[], currentProfileId: string) {
  return {
    profiles,
    currentProfileId,
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    deleteAllProfiles: vi.fn(),
    switchProfile: switchProfileMock,
  };
}

describe('Profiles Page', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    switchProfileMock.mockClear();
    useCurrentProfileMock.mockReset();
    useProfileStoreMock.mockReset();
  });

  it('renders profile list and active indicator', () => {
    useCurrentProfileMock.mockReturnValue({
      currentProfile: HOME,
      isAllMode: false,
    });
    useProfileStoreMock.mockReturnValue(storeState([HOME], 'p1'));

    render(<Profiles />);

    expect(screen.getByTestId('profile-list')).toBeInTheDocument();
    expect(screen.getByTestId('profile-card')).toBeInTheDocument();
    expect(screen.getByTestId('profile-active-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('profile-name')).toHaveTextContent('Home');
  });

  it('does not render the All Servers card with fewer than 2 profiles', () => {
    useCurrentProfileMock.mockReturnValue({
      currentProfile: HOME,
      isAllMode: false,
    });
    useProfileStoreMock.mockReturnValue(storeState([HOME], 'p1'));

    render(<Profiles />);

    expect(screen.queryByTestId('profile-card-all')).not.toBeInTheDocument();
  });

  it('renders the All Servers card with 2+ profiles and marks it active in All mode', () => {
    useCurrentProfileMock.mockReturnValue({
      currentProfile: null,
      isAllMode: true,
    });
    useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], ALL_PROFILES_ID));

    render(<Profiles />);

    const allCard = screen.getByTestId('profile-card-all');
    expect(allCard).toBeInTheDocument();
    expect(allCard).toHaveTextContent('profiles.all_servers');
    expect(screen.getByTestId('profile-active-indicator')).toBeInTheDocument();
  });

  it('switches to the All Servers sentinel and navigates to /monitors on click', async () => {
    const user = userEvent.setup();
    useCurrentProfileMock.mockReturnValue({
      currentProfile: HOME,
      isAllMode: false,
    });
    useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], 'p1'));

    render(<Profiles />);

    await user.click(screen.getByTestId('profile-card-all'));

    expect(switchProfileMock).toHaveBeenCalledWith(ALL_PROFILES_ID);
    expect(mockNavigate).toHaveBeenCalledWith('/monitors');
  });
});
