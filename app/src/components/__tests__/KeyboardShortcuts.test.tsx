/**
 * Coverage for the `?` key branch (refs #246): it must open the floating
 * assistant window when the assistant is enabled, and fall back to the help
 * overlay when it is not. This is the acceptance-criterion line for issue
 * #246 finding 2.
 *
 * Plus the All-mode behavior (refs #337, audit C10/C11): every shortcut is
 * profile-independent navigation, so the whole handler must stay live while
 * the ALL sentinel is selected, and the numeric monitor jump must land on the
 * owning profile's `/all/monitors/:profileId/:id` route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('../../api/store-gates', () => import('../../tests/fake-store-gates'));
vi.mock('../../lib/security/secureStorage', () => import('../../tests/fake-secure-storage'));

import { KeyboardShortcuts } from '../KeyboardShortcuts';
import { useAssistantPanelStore } from '../../stores/assistantPanel';
import { seedProfiles, resetProfileFixture } from '../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../tests/fake-store-gates';
import { ALL_PROFILES_ID } from '../../api/types';

// The Dialog's open state is a React state update, so the dispatched keydown
// must be wrapped in act() to flush it before asserting on the DOM.
function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  });
}

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: '/dashboard' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
// useTvMode is the last edge into useCurrentProfile → stores/profile, whose
// module-init gates need the whole auth/session graph. Mocking it keeps this
// suite to the component under test.
vi.mock('../../hooks/useTvMode', () => ({ useTvMode: () => ({ isTvMode: false }) }));
vi.mock('../../lib/profile/profile-settings', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getExcludedMonitorIdSet: () => new Set<string>(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

// The `?` key's gate. Not the scope's settings any more: an aggregate's own
// bucket never holds assistantEnabled, so the gate resolves over the scope's
// profiles instead (refs #337).
const useAssistantEnabledMock = vi.fn(() => ({ enabled: false, profileId: 'p1' }));
vi.mock('../../hooks/useAssistantEnabled', () => ({
  useAssistantEnabled: () => useAssistantEnabledMock(),
}));

// Two servers, same monitor id 3: the jump must resolve to the FIRST one in
// profile-then-server order, exactly what the Monitors page lists.
const scopedMonitorsMock = vi.fn((_options?: unknown) => ({
  monitors: [] as Array<{ profileId: string; profileName: string; item: { Monitor: { Id: string; Name: string } } }>,
}));
vi.mock('../../hooks/useScopedMonitors', () => ({
  useScopedMonitors: (options: unknown) => scopedMonitorsMock(options),
}));

describe('KeyboardShortcuts "?" key', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    seedProfiles(['p1']);
    useAssistantEnabledMock.mockReturnValue({ enabled: false, profileId: 'p1' });
    scopedMonitorsMock.mockReturnValue({ monitors: [] });
    useAssistantPanelStore.setState({ state: 'closed', size: { width: 400, height: 560 } });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('opens the help overlay and does not open the assistant panel when the assistant is disabled', () => {
    render(<KeyboardShortcuts />);
    press('?');

    expect(useAssistantPanelStore.getState().state).toBe('closed');
    expect(screen.getByTestId('keyboard-shortcuts-help')).toBeInTheDocument();
  });

  it('opens the assistant panel and does not open the help overlay when the assistant is enabled', () => {
    useAssistantEnabledMock.mockReturnValue({ enabled: true, profileId: 'p1' });
    render(<KeyboardShortcuts />);
    press('?');

    expect(useAssistantPanelStore.getState().state).toBe('open');
    expect(screen.queryByTestId('keyboard-shortcuts-help')).not.toBeInTheDocument();
  });
});

describe('KeyboardShortcuts in All mode (refs #337)', () => {
  const twoServers = {
    monitors: [
      { profileId: 'p1', profileName: 'Home', item: { Monitor: { Id: '3', Name: 'Front Door' } } },
      { profileId: 'p2', profileName: 'Cabin', item: { Monitor: { Id: '3', Name: 'Porch' } } },
      { profileId: 'p2', profileName: 'Cabin', item: { Monitor: { Id: '7', Name: 'Gate' } } },
    ],
  };

  beforeEach(() => {
    navigateMock.mockClear();
    seedProfiles(['p1', 'p2'], { current: ALL_PROFILES_ID });
    useAssistantEnabledMock.mockReturnValue({ enabled: false, profileId: 'p1' });
    scopedMonitorsMock.mockReturnValue(twoServers);
    useAssistantPanelStore.setState({ state: 'closed', size: { width: 400, height: 560 } });
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  // These two components mount for the whole session and share the monitors
  // query key with the Monitors page. React Query polls a shared query on the
  // shortest interval ANY observer asks for, so without the opt-out this turns
  // a page-scoped refresh into a permanent one, times the profiles in scope.
  it('asks the scoped hook not to poll', () => {
    render(<KeyboardShortcuts />);
    expect(scopedMonitorsMock).toHaveBeenCalledWith({ poll: false });
  });

  it('navigates on a page shortcut while the ALL sentinel is selected', () => {
    render(<KeyboardShortcuts />);
    press('e');
    expect(navigateMock).toHaveBeenCalledWith('/events');
  });

  it('opens the help overlay on "?" while the ALL sentinel is selected', () => {
    render(<KeyboardShortcuts />);
    press('?');
    expect(screen.getByTestId('keyboard-shortcuts-help')).toBeInTheDocument();
  });

  it('jumps a colliding monitor id to the first owning profile\'s /all/ route', () => {
    render(<KeyboardShortcuts />);
    press('3');
    press('Enter');
    expect(navigateMock).toHaveBeenCalledWith('/all/monitors/p1/3', { state: { from: '/dashboard' } });
  });

  it('jumps a second server\'s own monitor id to that server\'s /all/ route', () => {
    render(<KeyboardShortcuts />);
    press('7');
    press('Enter');
    expect(navigateMock).toHaveBeenCalledWith('/all/monitors/p2/7', { state: { from: '/dashboard' } });
  });

  // Escape is a plain back-navigation with nothing open, and All mode is no
  // exception now that the handler runs there - the e2e steps that press it
  // must not do so speculatively (refs #337).
  it('navigates back on Escape with no overlay open', () => {
    render(<KeyboardShortcuts />);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(navigateMock).toHaveBeenCalledWith(-1);
  });

  it('keeps the bare monitor route in single mode', () => {
    seedProfiles(['p1', 'p2']);
    scopedMonitorsMock.mockReturnValue({
      monitors: [{ profileId: 'p1', profileName: 'Home', item: { Monitor: { Id: '7', Name: 'Gate' } } }],
    });
    render(<KeyboardShortcuts />);
    press('7');
    press('Enter');
    expect(navigateMock).toHaveBeenCalledWith('/monitors/7', { state: { from: '/dashboard' } });
  });
});
