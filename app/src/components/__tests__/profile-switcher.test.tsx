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
import { ALL_PROFILES_ID } from '../../api/types';

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
  profiles: Array<{ id: string; name: string; portalUrl: string }>;
  currentProfileId: string | null;
  switchProfile: typeof switchProfileMock;
};

function setProfiles(profiles: Array<{ id: string; name: string; portalUrl: string }>) {
  mockProfileState = {
    profiles,
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
});
