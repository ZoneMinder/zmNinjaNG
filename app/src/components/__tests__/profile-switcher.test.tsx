/**
 * profile-switcher-all only appears once there are 2+ profiles (All mode is
 * meaningless with a single server) and, when clicked, must switch to the
 * ALL_PROFILES_ID sentinel. Refs #337.
 *
 * The dropdown-menu primitives are Radix (portal + open-state driven), which
 * jsdom cannot drive via a real trigger click/pointer-capture sequence (no
 * existing test in this repo does - Settings.test.tsx stubs Select the same
 * way for the same reason). Stubbed here as plain passthrough elements so
 * DropdownMenuContent's children (the actual menu-item render logic under
 * test) are always present in the DOM.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ProfileSwitcher } from '../profile-switcher';
import { ALL_PROFILES_ID, mintVirtualProfileId } from '../../api/types';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('sonner', () => ({
  toast: {
    dismiss: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../lib/logger', () => ({
  log: { profile: vi.fn() },
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 },
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: unknown) => fn,
}));

vi.mock('../ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onClick,
    ...props
  }: { children: ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

const switchProfileMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: unknown) => unknown) => selector(mockProfileState),
}));

let mockProfileState: {
  profiles: Array<{ id: string; name: string; portalUrl: string; disabled?: boolean }>;
  virtualProfiles: Array<{ id: string; name: string; memberProfileIds: string[] }>;
  currentProfileId: string | null;
  switchProfile: typeof switchProfileMock;
};

function setProfiles(profiles: Array<{ id: string; name: string; portalUrl: string; disabled?: boolean }>) {
  mockProfileState = {
    profiles,
    virtualProfiles: [],
    currentProfileId: profiles[0]?.id ?? null,
    switchProfile: switchProfileMock,
  };
}

const profileA = { id: 'profile-a', name: 'Home', portalUrl: 'https://a.example.com' };
const profileB = { id: 'profile-b', name: 'Office', portalUrl: 'https://b.example.com' };

describe('ProfileSwitcher', () => {
  beforeEach(() => {
    switchProfileMock.mockClear();
    navigateMock.mockClear();
  });

  it('has no All Servers item with a single profile', () => {
    setProfiles([profileA]);

    render(<ProfileSwitcher />);

    expect(screen.queryByTestId('profile-switcher-all')).not.toBeInTheDocument();
  });

  it('shows the All Servers item once there are 2+ profiles', () => {
    setProfiles([profileA, profileB]);

    render(<ProfileSwitcher />);

    expect(screen.getByTestId('profile-switcher-all')).toBeInTheDocument();
  });

  it('switches to the ALL_PROFILES_ID sentinel when clicked', () => {
    setProfiles([profileA, profileB]);

    render(<ProfileSwitcher />);
    fireEvent.click(screen.getByTestId('profile-switcher-all'));

    expect(switchProfileMock).toHaveBeenCalledWith(ALL_PROFILES_ID);
  });

  // refs #337 round 2: moved to the end for consistency with the Profiles page.
  it('places the All Servers item after every profile item', () => {
    setProfiles([profileA, profileB]);

    render(<ProfileSwitcher />);

    const items = screen.getAllByTestId(/^profile-switcher-(item-.+|all)$/);
    expect(items.at(-1)).toBe(screen.getByTestId('profile-switcher-all'));
  });

  // A group is an aggregate too, but a different one: the trigger names it,
  // and the All Servers row must not read as the current selection (refs #337).
  describe('with a group active', () => {
    const group = mintVirtualProfileId();

    beforeEach(() => {
      setProfiles([profileA, profileB]);
      mockProfileState.currentProfileId = group;
      mockProfileState.virtualProfiles = [
        { id: group, name: 'Backyard', memberProfileIds: ['profile-b'] },
      ];
    });

    it("names the group on the trigger", () => {
      render(<ProfileSwitcher />);

      expect(screen.getByTestId('profile-switcher-trigger')).toHaveTextContent('Backyard');
    });

    // A group deleted in another tab, or hand-edited out of storage, leaves
    // the id current with nothing behind it. Nothing is aggregating then, so
    // naming it "All Servers" would claim a selection the user does not have.
    it('does not claim All Servers when the current group no longer exists', () => {
      mockProfileState.virtualProfiles = [];

      render(<ProfileSwitcher />);

      const trigger = screen.getByTestId('profile-switcher-trigger');
      expect(trigger).toHaveTextContent('profiles.select_profile');
      expect(trigger).not.toHaveTextContent('profiles.all_servers');
    });

    it('leaves the All Servers item unmarked', () => {
      render(<ProfileSwitcher />);

      expect(screen.queryByTestId('profile-switcher-all-active')).not.toBeInTheDocument();
    });

    it('lists the group under the All Servers item, named and ticked', () => {
      render(<ProfileSwitcher />);

      const items = screen.getAllByTestId(/^profile-switcher-(item-.+|all|virtual-.+)$/);
      const entry = screen.getByTestId(`profile-switcher-virtual-${group}`);
      expect(items.at(-1)).toBe(entry);
      expect(items.at(-2)).toBe(screen.getByTestId('profile-switcher-all'));
      expect(entry).toHaveTextContent('Backyard');
      expect(screen.getByTestId(`profile-switcher-active-virtual-${group}`)).toBeInTheDocument();
    });

    it('switches to the group id when its entry is clicked', () => {
      mockProfileState.currentProfileId = 'profile-a';

      render(<ProfileSwitcher />);
      fireEvent.click(screen.getByTestId(`profile-switcher-virtual-${group}`));

      expect(switchProfileMock).toHaveBeenCalledWith(group);
    });

    it('leaves the group entry unticked while All Servers is active', () => {
      mockProfileState.currentProfileId = ALL_PROFILES_ID;

      render(<ProfileSwitcher />);

      expect(screen.getByTestId(`profile-switcher-virtual-${group}`)).toBeInTheDocument();
      expect(
        screen.queryByTestId(`profile-switcher-active-virtual-${group}`)
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('profile-switcher-all-active')).toBeInTheDocument();
    });

    // Same gate as the All Servers item: one selectable server aggregates
    // nothing, whichever aggregate is named.
    it('hides groups once fewer than 2 profiles are selectable', () => {
      setProfiles([profileA, { ...profileB, disabled: true }]);
      mockProfileState.virtualProfiles = [
        { id: group, name: 'Backyard', memberProfileIds: ['profile-b'] },
      ];

      render(<ProfileSwitcher />);

      expect(screen.queryByTestId(`profile-switcher-virtual-${group}`)).not.toBeInTheDocument();
    });
  });

  it('marks the All Servers item while the sentinel is active', () => {
    setProfiles([profileA, profileB]);
    mockProfileState.currentProfileId = ALL_PROFILES_ID;

    render(<ProfileSwitcher />);

    expect(screen.getByTestId('profile-switcher-all-active')).toBeInTheDocument();
    expect(screen.getByTestId('profile-switcher-trigger')).toHaveTextContent('profiles.all_servers');
  });

  it('hides a disabled profile from the list (refs #337)', () => {
    setProfiles([profileA, { ...profileB, disabled: true }]);

    render(<ProfileSwitcher />);

    expect(screen.getByTestId('profile-switcher-item-profile-a')).toBeInTheDocument();
    expect(screen.queryByTestId('profile-switcher-item-profile-b')).not.toBeInTheDocument();
    // Only one selectable profile remains, so the All Servers item hides too.
    expect(screen.queryByTestId('profile-switcher-all')).not.toBeInTheDocument();
  });
});
