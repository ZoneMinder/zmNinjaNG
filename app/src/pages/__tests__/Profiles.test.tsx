import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Profiles from '../Profiles';
import { ALL_PROFILES_ID } from '../../api/types';
import { ProfileGuardError } from '../../stores/profile';

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
  mergeProfileSettings: vi.fn((raw?: Record<string, unknown>) => ({
    viewMode: 'snapshot',
    displayMode: 'normal',
    theme: 'light',
    ...raw,
  })),
}));

const switchProfileMock = vi.fn(() => Promise.resolve());
const setProfileDisabledMock = vi.fn();
const useProfileStoreMock = vi.fn();
vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: any) => unknown) => selector(useProfileStoreMock()),
  ProfileGuardError: class ProfileGuardError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
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
    setProfileDisabled: setProfileDisabledMock,
  };
}

describe('Profiles Page', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    switchProfileMock.mockClear();
    setProfileDisabledMock.mockReset();
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

  // refs #337: per-profile disable toggle
  it('renders a disable toggle for every profile and flips a non-active one', async () => {
    const user = userEvent.setup();
    useCurrentProfileMock.mockReturnValue({ currentProfile: HOME, isAllMode: false });
    useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], 'p1'));

    render(<Profiles />);
    await user.click(screen.getByTestId('profile-disable-toggle-p2'));

    expect(setProfileDisabledMock).toHaveBeenCalledWith('p2', true);
  });

  it('shows a muted card and Disabled badge for a disabled profile, hiding its switch button', () => {
    const disabledOffice = { ...OFFICE, disabled: true };
    useCurrentProfileMock.mockReturnValue({ currentProfile: HOME, isAllMode: false });
    useProfileStoreMock.mockReturnValue(storeState([HOME, disabledOffice], 'p1'));

    render(<Profiles />);

    expect(screen.getByTestId('profile-disabled-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('profile-switch-button-p2')).not.toBeInTheDocument();
    // Edit, delete, and the re-enable toggle stay available.
    expect(screen.getByTestId('profile-edit-button-p2')).toBeInTheDocument();
    expect(screen.getByTestId('profile-delete-button-p2')).toBeInTheDocument();
    expect(screen.getByTestId('profile-disable-toggle-p2')).toBeInTheDocument();
  });

  it('hides the All Servers card when fewer than 2 profiles are enabled', () => {
    const disabledOffice = { ...OFFICE, disabled: true };
    useCurrentProfileMock.mockReturnValue({ currentProfile: HOME, isAllMode: false });
    useProfileStoreMock.mockReturnValue(storeState([HOME, disabledOffice], 'p1'));

    render(<Profiles />);

    expect(screen.queryByTestId('profile-card-all')).not.toBeInTheDocument();
  });

  it('shows an error toast when disabling the active profile is rejected', async () => {
    const user = userEvent.setup();
    const { toast: sonnerToast } = await import('sonner');
    setProfileDisabledMock.mockImplementation(() => {
      throw new ProfileGuardError('Cannot disable the active profile p1', 'CANNOT_DISABLE_CURRENT');
    });
    useCurrentProfileMock.mockReturnValue({ currentProfile: HOME, isAllMode: false });
    useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], 'p1'));

    render(<Profiles />);
    await user.click(screen.getByTestId('profile-disable-toggle-p1'));

    expect(setProfileDisabledMock).toHaveBeenCalledWith('p1', true);
    expect(sonnerToast.error).toHaveBeenCalledWith('profiles.cannot_disable_active');
  });
});
