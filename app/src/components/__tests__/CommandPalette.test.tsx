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

const singleMonitors = [
  { profileId: 'p1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door' } } },
  { profileId: 'p1', profileName: 'Home', item: { Monitor: { Id: '12', Name: 'Driveway' } } },
];
// Both servers own a monitor called "Front ..." with the SAME id 1: the two
// must stay distinct rows, each labelled with its owning server.
const allMonitors = [
  { profileId: 'p1', profileName: 'Home', item: { Monitor: { Id: '1', Name: 'Front Door' } } },
  { profileId: 'p2', profileName: 'Cabin', item: { Monitor: { Id: '1', Name: 'Front Gate' } } },
];
const scopedMonitorsMock = vi.fn(() => ({ monitors: singleMonitors }));
vi.mock('../../hooks/useScopedMonitors', () => ({
  useScopedMonitors: () => scopedMonitorsMock(),
}));

const singleScope = {
  mode: 'single' as const,
  profile: { id: 'p1' },
  profiles: [{ id: 'p1' }],
  settings: { assistantEnabled: false },
};
const allScope = {
  mode: 'all' as const,
  profile: null,
  profiles: [{ id: 'p1' }, { id: 'p2' }],
  settings: { assistantEnabled: false },
};
const useProfileScopeMock = vi.fn<() => unknown>(() => singleScope);
vi.mock('../../hooks/useProfileScope', () => ({
  useProfileScope: () => useProfileScopeMock(),
}));

// Groups are per-server entities with no cross-server aggregation, so All mode
// gets an empty list here - the same thing the real useGroups returns while the
// ALL sentinel is selected (its query is current-profile gated).
const groupsMock = vi.fn(() => ({ groups: [{ Group: { Id: '1', Name: 'Front Cameras' } }] }));
vi.mock('../../hooks/useGroups', () => ({ useGroups: () => groupsMock() }));
const setSelectedGroup = vi.fn();
vi.mock('../../hooks/useGroupFilter', () => ({
  useGroupFilter: () => ({ setSelectedGroup }),
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
    useProfileScopeMock.mockReturnValue(singleScope);
    scopedMonitorsMock.mockReturnValue({ monitors: singleMonitors });
    groupsMock.mockReturnValue({ groups: [{ Group: { Id: '1', Name: 'Front Cameras' } }] });
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

  it('keeps row numbering continuous across a group header', () => {
    render(<CommandPalette />);
    const input = screen.getByTestId('command-palette-input');
    // "front" matches one group (Front Cameras) and one monitor (Front Door),
    // so the list renders two kinds with a header on the first row of each.
    fireEvent.change(input, { target: { value: 'front' } });

    expect(screen.getByText('command_palette.group_groups')).toBeInTheDocument();
    expect(screen.getByText('command_palette.group_monitors')).toBeInTheDocument();

    const groupRow = screen.getByTestId('command-item-group-1');
    const monitorRow = screen.getByTestId('command-item-monitor-1');
    // Headers must not consume a row number: the two options are 0 and 1.
    expect(groupRow).toHaveAttribute('id', 'command-option-0');
    expect(monitorRow).toHaveAttribute('id', 'command-option-1');

    expect(groupRow).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'command-option-1');
    expect(screen.getByTestId('command-item-monitor-1')).toHaveAttribute('aria-selected', 'true');
  });

  it('does not show the Ask item when the assistant is disabled', () => {
    render(<CommandPalette />);
    expect(screen.queryByTestId('command-item-ask')).not.toBeInTheDocument();
  });

  it('shows the Ask item when the assistant is enabled and opens the floating assistant window on click', () => {
    useProfileScopeMock.mockReturnValue({ ...singleScope, settings: { assistantEnabled: true } });
    render(<CommandPalette />);
    fireEvent.click(screen.getByTestId('command-item-ask'));
    // Clicking Ask closes the palette and opens the standalone assistant
    // panel; the assistant no longer renders inside this component (refs #246).
    expect(useCommandPaletteStore.getState().open).toBe(false);
    expect(useAssistantPanelStore.getState().state).toBe('open');
  });
});

describe('CommandPalette in All mode (refs #337)', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    scrollIntoViewMock.mockClear();
    useCommandPaletteStore.setState({ open: true });
    useAssistantPanelStore.setState({ state: 'closed', size: { width: 400, height: 560 } });
    useProfileScopeMock.mockReturnValue(allScope);
    scopedMonitorsMock.mockReturnValue({ monitors: allMonitors });
    groupsMock.mockReturnValue({ groups: [] });
  });

  it('lists a colliding monitor id once per server, each labelled with its server', () => {
    render(<CommandPalette />);
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'front' } });

    expect(screen.getByTestId('command-item-monitor-p1-1')).toHaveTextContent('Front Door');
    expect(screen.getByTestId('command-item-monitor-p1-1')).toHaveTextContent('Home');
    expect(screen.getByTestId('command-item-monitor-p2-1')).toHaveTextContent('Front Gate');
    expect(screen.getByTestId('command-item-monitor-p2-1')).toHaveTextContent('Cabin');
  });

  it('navigates a monitor to the owning profile\'s /all/ route', () => {
    render(<CommandPalette />);
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'front' } });
    fireEvent.click(screen.getByTestId('command-item-monitor-p2-1'));
    expect(navigateMock).toHaveBeenCalledWith('/all/monitors/p2/1', expect.anything());
  });

  it('omits group entries, keeping the pages it does list navigable', () => {
    render(<CommandPalette />);
    expect(screen.queryByText('command_palette.group_groups')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('command-item-page-/montage'));
    expect(navigateMock).toHaveBeenCalledWith('/montage');
  });
});
