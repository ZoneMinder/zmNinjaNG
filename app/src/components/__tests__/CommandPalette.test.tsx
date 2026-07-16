import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette } from '../CommandPalette';
import { useCommandPaletteStore } from '../../stores/commandPalette';

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
vi.mock('../assistant/AskPanel', () => ({
  AskPanel: () => <div data-testid="ask-panel-mock" />,
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
    useCommandPaletteStore.setState({ open: true, mode: 'command' });
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

  it('shows the Ask item when the assistant is enabled and opens Ask mode on click', () => {
    useCurrentProfileMock.mockReturnValue({
      currentProfile: { id: 'p1' },
      settings: { assistantEnabled: true },
    });
    render(<CommandPalette />);
    fireEvent.click(screen.getByTestId('command-item-ask'));
    expect(useCommandPaletteStore.getState().mode).toBe('ask');
    expect(screen.getByTestId('ask-panel-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('command-palette-results')).not.toBeInTheDocument();
  });

  it('does not switch to Ask mode when the input starts with "?" and the assistant is disabled', () => {
    render(<CommandPalette />);
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: '?' } });
    expect(useCommandPaletteStore.getState().mode).toBe('command');
    expect(screen.queryByTestId('ask-panel-mock')).not.toBeInTheDocument();
    expect(screen.getByTestId('command-palette-results')).toBeInTheDocument();
  });

  it('switches to Ask mode when the input starts with "?" and the assistant is enabled', () => {
    useCurrentProfileMock.mockReturnValue({
      currentProfile: { id: 'p1' },
      settings: { assistantEnabled: true },
    });
    render(<CommandPalette />);
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: '?' } });
    expect(useCommandPaletteStore.getState().mode).toBe('ask');
    expect(screen.getByTestId('ask-panel-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('command-palette-results')).not.toBeInTheDocument();
  });
});
