import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Profiles from '../Profiles';
import { ALL_PROFILES_ID, mintVirtualProfileId } from '../../api/types';
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

const deleteVirtualProfileMock = vi.fn();

function storeState(
  profiles: typeof HOME[],
  currentProfileId: string,
  virtualProfiles: { id: string; name: string; memberProfileIds: string[] }[] = []
) {
  return {
    profiles,
    virtualProfiles,
    currentProfileId,
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    deleteAllProfiles: vi.fn(),
    switchProfile: switchProfileMock,
    setProfileDisabled: setProfileDisabledMock,
    deleteVirtualProfile: deleteVirtualProfileMock,
    addVirtualProfile: vi.fn(),
    updateVirtualProfile: vi.fn(),
    profileExists: vi.fn(() => false),
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

  // A group aggregates like All Servers but is a different selection, so the
  // All Servers card must not claim to be the active one (refs #337).
  it('leaves the All Servers card unmarked while a group is current', () => {
    const group = mintVirtualProfileId();
    useCurrentProfileMock.mockReturnValue({
      currentProfile: null,
      isAllMode: true,
    });
    useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], group));

    render(<Profiles />);

    expect(screen.getByTestId('profile-card-all')).toBeInTheDocument();
    expect(screen.queryByTestId('profile-active-indicator')).not.toBeInTheDocument();
  });

  // refs #337 round 2: the All Servers card moved to the end of the list.
  it('renders the All Servers card after every profile card, with the resource note', () => {
    useCurrentProfileMock.mockReturnValue({ currentProfile: HOME, isAllMode: false });
    useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], 'p1'));

    render(<Profiles />);

    const cards = screen.getAllByTestId(/^profile-card(-all)?$/);
    expect(cards.at(-1)).toBe(screen.getByTestId('profile-card-all'));
    expect(screen.getByTestId('profile-card-all-note')).toHaveTextContent(
      'profiles.all_servers_resource_note'
    );
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

  // Group cards: the visible half of virtual profiles (refs #337, spec 11).
  describe('group cards', () => {
    const GROUP = { id: mintVirtualProfileId(), name: 'Backyard', memberProfileIds: ['p2'] };

    beforeEach(() => {
      deleteVirtualProfileMock.mockReset();
      useCurrentProfileMock.mockReturnValue({ currentProfile: HOME, isAllMode: false });
    });

    it('names the group, counts its members, and warns about the cost', () => {
      useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], 'p1', [GROUP]));

      render(<Profiles />);

      const card = screen.getByTestId(`profile-card-virtual-${GROUP.id}`);
      expect(card).toHaveTextContent('Backyard');
      expect(card).toHaveTextContent('profiles.group_member_count:{"count":1}');
      expect(card).toHaveTextContent('profiles.group_resource_note');
    });

    it('renders group cards after the All Servers card', () => {
      useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], 'p1', [GROUP]));

      render(<Profiles />);

      const cards = screen.getAllByTestId(/^profile-card(-all|-virtual-.+)?$/);
      expect(cards.at(-1)).toBe(screen.getByTestId(`profile-card-virtual-${GROUP.id}`));
    });

    it('marks the group card active while that group is current', () => {
      useCurrentProfileMock.mockReturnValue({ currentProfile: null, isAllMode: true });
      useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], GROUP.id, [GROUP]));

      render(<Profiles />);

      const card = screen.getByTestId(`profile-card-virtual-${GROUP.id}`);
      expect(card.querySelector('[data-testid="profile-active-indicator"]')).toBeInTheDocument();
    });

    it('switches to the group id when its card is clicked', async () => {
      const user = userEvent.setup();
      useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], 'p1', [GROUP]));

      render(<Profiles />);
      await user.click(screen.getByTestId(`profile-card-virtual-${GROUP.id}`));

      expect(switchProfileMock).toHaveBeenCalledWith(GROUP.id);
      expect(mockNavigate).toHaveBeenCalledWith('/monitors');
    });

    // Same gate as the All Servers card: with one selectable server there is
    // nothing to group.
    it('offers the New group action only with 2+ enabled profiles', () => {
      const disabledOffice = { ...OFFICE, disabled: true };
      useProfileStoreMock.mockReturnValue(storeState([HOME, disabledOffice], 'p1', []));
      const { unmount } = render(<Profiles />);
      expect(screen.queryByTestId('profile-new-group-button')).not.toBeInTheDocument();
      unmount();

      useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], 'p1', []));
      render(<Profiles />);
      expect(screen.getByTestId('profile-new-group-button')).toBeInTheDocument();
    });

    it('opens the dialog in edit mode from the group card', async () => {
      const user = userEvent.setup();
      useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], 'p1', [GROUP]));

      render(<Profiles />);
      await user.click(screen.getByTestId(`profile-virtual-edit-${GROUP.id}`));

      expect(screen.getByTestId('virtual-profile-dialog')).toHaveTextContent(
        'profiles.group_edit_title'
      );
      expect(screen.getByTestId('virtual-profile-name')).toHaveValue('Backyard');
      // Editing a group must not also switch to it.
      expect(switchProfileMock).not.toHaveBeenCalled();
    });

    it('opens the dialog in create mode from the New group action', async () => {
      const user = userEvent.setup();
      useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], 'p1', []));

      render(<Profiles />);
      await user.click(screen.getByTestId('profile-new-group-button'));

      expect(screen.getByTestId('virtual-profile-dialog')).toHaveTextContent(
        'profiles.group_create_title'
      );
    });

    // The confirmation has to say the member servers survive; without that
    // line, "Delete Backyard?" reads as deleting the two servers in it.
    it('confirms the delete, promises the servers survive, then deletes only the group', async () => {
      const user = userEvent.setup();
      useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], 'p1', [GROUP]));

      render(<Profiles />);
      await user.click(screen.getByTestId(`profile-virtual-delete-${GROUP.id}`));

      expect(screen.getByTestId('profile-virtual-delete-dialog')).toHaveTextContent(
        'profiles.delete_group_confirm_desc:{"name":"Backyard"}'
      );
      expect(deleteVirtualProfileMock).not.toHaveBeenCalled();

      await user.click(screen.getByTestId('profile-virtual-delete-confirm'));

      expect(deleteVirtualProfileMock).toHaveBeenCalledWith(GROUP.id);
      expect(switchProfileMock).not.toHaveBeenCalled();
    });

    it('reports a failed group delete instead of closing silently', async () => {
      const user = userEvent.setup();
      const { toast: sonnerToast } = await import('sonner');
      deleteVirtualProfileMock.mockImplementation(() => {
        throw new Error('Virtual profile not found');
      });
      useProfileStoreMock.mockReturnValue(storeState([HOME, OFFICE], 'p1', [GROUP]));

      render(<Profiles />);
      await user.click(screen.getByTestId(`profile-virtual-delete-${GROUP.id}`));
      await user.click(screen.getByTestId('profile-virtual-delete-confirm'));

      expect(sonnerToast.error).toHaveBeenCalledWith('profiles.delete_group_error');
    });
  });
});
