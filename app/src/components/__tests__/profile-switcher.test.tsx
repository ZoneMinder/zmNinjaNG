/**
 * The switcher's aggregate entries are virtual profile groups: they appear
 * once there are 2+ selectable profiles (an aggregate is meaningless with a
 * single server) and, when clicked, switch to the group's own id. The built-in
 * All Servers entry is gone. Refs #337.
 *
 * The dropdown-menu primitives are Radix (portal + open-state driven), which
 * jsdom cannot drive via a real trigger click/pointer-capture sequence (no
 * existing test in this repo does - Settings.test.tsx stubs Select the same
 * way for the same reason). Stubbed here as plain passthrough elements so
 * DropdownMenuContent's children (the actual menu-item render logic under
 * test) are always present in the DOM.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ProfileSwitcher } from '../profile-switcher';
import { mintVirtualProfileId, asProfileId } from '../../api/types';
import { useSettingsStore } from '../../stores/settings';

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

  // No built-in aggregate is offered any more, at any profile count: groups
  // replaced it (refs #337).
  it('has no All Servers item, whatever the profile count', () => {
    setProfiles([profileA, profileB]);

    render(<ProfileSwitcher />);

    expect(screen.getByTestId('profile-switcher-item-profile-b')).toBeInTheDocument();
    expect(screen.queryByTestId('profile-switcher-all')).not.toBeInTheDocument();
  });

  // A group is the only aggregate left, and the trigger names it (refs #337).
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

    it('lists the group after every profile item, named and ticked', () => {
      render(<ProfileSwitcher />);

      const items = screen.getAllByTestId(/^profile-switcher-(item-.+|virtual-.+)$/);
      const entry = screen.getByTestId(`profile-switcher-virtual-${group}`);
      expect(items.at(-1)).toBe(entry);
      expect(entry).toHaveTextContent('Backyard');
      expect(screen.getByTestId(`profile-switcher-active-virtual-${group}`)).toBeInTheDocument();
    });

    it('switches to the group id when its entry is clicked', () => {
      mockProfileState.currentProfileId = 'profile-a';

      render(<ProfileSwitcher />);
      fireEvent.click(screen.getByTestId(`profile-switcher-virtual-${group}`));

      expect(switchProfileMock).toHaveBeenCalledWith(group);
    });

    // The group has its own lastRoute bucket, and a switch used to discard it
    // and land on /monitors every time (refs #337).
    it('lands on the page the group was last on', async () => {
      setProfiles([profileA, profileB]);
      mockProfileState.virtualProfiles = [
        { id: group, name: 'Backyard', memberProfileIds: ['profile-a', 'profile-b'] },
      ];
      useSettingsStore.getState().updateProfileSettings(asProfileId(group), { lastRoute: '/timeline' });

      render(<ProfileSwitcher />);
      fireEvent.click(screen.getByTestId(`profile-switcher-virtual-${group}`));

      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/timeline'));
    });

    // A group can still be listed while holding nothing selectable, when the
    // other profiles keep the >= 2 gate open. Switching to it would land on
    // empty screens, so the entry is there but disabled.
    it('disables a group whose members are all unselectable', () => {
      const profileC = { id: 'profile-c', name: 'Shed', portalUrl: 'https://c.example.com' };
      setProfiles([profileA, profileB, { ...profileC, disabled: true }]);
      mockProfileState.virtualProfiles = [
        { id: group, name: 'Backyard', memberProfileIds: ['profile-c'] },
      ];

      render(<ProfileSwitcher />);
      const entry = screen.getByTestId(`profile-switcher-virtual-${group}`);
      expect(entry).toBeDisabled();

      fireEvent.click(entry);
      expect(switchProfileMock).not.toHaveBeenCalled();
    });

    // One selectable server aggregates nothing, whichever group is named.
    it('hides groups once fewer than 2 profiles are selectable', () => {
      setProfiles([profileA, { ...profileB, disabled: true }]);
      mockProfileState.virtualProfiles = [
        { id: group, name: 'Backyard', memberProfileIds: ['profile-b'] },
      ];

      render(<ProfileSwitcher />);

      expect(screen.queryByTestId(`profile-switcher-virtual-${group}`)).not.toBeInTheDocument();
    });
  });

  it('hides a disabled profile from the list (refs #337)', () => {
    setProfiles([profileA, { ...profileB, disabled: true }]);

    render(<ProfileSwitcher />);

    expect(screen.getByTestId('profile-switcher-item-profile-a')).toBeInTheDocument();
    expect(screen.queryByTestId('profile-switcher-item-profile-b')).not.toBeInTheDocument();
  });
});
