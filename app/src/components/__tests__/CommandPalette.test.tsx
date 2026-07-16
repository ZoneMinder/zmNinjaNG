import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette } from '../CommandPalette';
import { useCommandPaletteStore } from '../../stores/commandPalette';
import { useAssistantPanelStore } from '../../stores/assistantPanel';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: '/dashboard' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: { monitors: [{ Monitor: { Id: '1', Name: 'Front Door' } }, { Monitor: { Id: '12', Name: 'Driveway' } }] },
  }),
}));
// Mock the API module to prevent transitive loading of stores/profile (which
// calls useAuthStore.subscribe at module init time via log-sanitizer → client).
vi.mock('../../api/monitors', () => ({ getMonitors: vi.fn() }));
vi.mock('../../hooks/useGroups', () => ({
  useGroups: () => ({ groups: [{ Group: { Id: '1', Name: 'Front Cameras' } }] }),
}));
const setSelectedGroup = vi.fn();
vi.mock('../../hooks/useGroupFilter', () => ({
  useGroupFilter: () => ({ setSelectedGroup }),
}));
const useCurrentProfileMock = vi.fn(() => ({
  currentProfile: { id: 'p1' },
  settings: { assistantEnabled: false },
}));
vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => useCurrentProfileMock(),
}));
vi.mock('../../stores/auth', () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) => sel({ isAuthenticated: true }),
}));
vi.mock('../../lib/profile/profile-settings', () => ({ getExcludedMonitorIdSet: () => new Set<string>() }));

// jsdom does not implement scrollIntoView; the keyboard-nav effect calls it.
const scrollIntoViewMock = vi.fn();
Element.prototype.scrollIntoView = scrollIntoViewMock;

describe('CommandPalette', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    setSelectedGroup.mockClear();
    scrollIntoViewMock.mockClear();
    useCommandPaletteStore.setState({ open: true });
    useAssistantPanelStore.setState({ state: 'closed', size: { width: 400, height: 560 } });
    useCurrentProfileMock.mockReturnValue({
      currentProfile: { id: 'p1' },
      settings: { assistantEnabled: false },
    });
  });

  it('filters monitors by name and navigates on Enter', () => {
    render(<CommandPalette />);
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'driveway' } });
    // First (and only) match becomes active; Enter commits.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigateMock).toHaveBeenCalledWith('/monitors/12', expect.anything());
  });

  it('shows pages without typing and navigates to one', () => {
    render(<CommandPalette />);
    // Montage page row is present with an empty query.
    const montage = screen.getByTestId('command-item-page-/montage');
    fireEvent.click(montage);
    expect(navigateMock).toHaveBeenCalledWith('/montage');
  });

  it('exposes combobox/listbox/option roles with aria-selected on the active row', () => {
    render(<CommandPalette />);
    const input = screen.getByTestId('command-palette-input');
    expect(input).toHaveAttribute('role', 'combobox');
    expect(screen.getByTestId('command-palette-results')).toHaveAttribute('role', 'listbox');
    // Empty query lists pages first; Dashboard is the first row and starts active.
    const firstOption = screen.getByTestId('command-item-page-/dashboard');
    expect(firstOption).toHaveAttribute('role', 'option');
    expect(firstOption).toHaveAttribute('aria-selected', 'true');
  });

  it('moves aria-activedescendant and scrolls the active row into view on ArrowDown', () => {
    render(<CommandPalette />);
    const input = screen.getByTestId('command-palette-input');
    const firstActive = input.getAttribute('aria-activedescendant');
    expect(firstActive).toBeTruthy();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const secondActive = input.getAttribute('aria-activedescendant');
    expect(secondActive).toBeTruthy();
    expect(secondActive).not.toBe(firstActive);
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('does not show the Ask item when the assistant is disabled', () => {
    render(<CommandPalette />);
    expect(screen.queryByTestId('command-item-ask')).not.toBeInTheDocument();
  });

  it('shows the Ask item when the assistant is enabled and opens the floating assistant window on click', () => {
    useCurrentProfileMock.mockReturnValue({
      currentProfile: { id: 'p1' },
      settings: { assistantEnabled: true },
    });
    render(<CommandPalette />);
    fireEvent.click(screen.getByTestId('command-item-ask'));
    // Clicking Ask closes the palette and opens the standalone assistant
    // panel; the assistant no longer renders inside this component (refs #246).
    expect(useCommandPaletteStore.getState().open).toBe(false);
    expect(useAssistantPanelStore.getState().state).toBe('open');
  });
});
