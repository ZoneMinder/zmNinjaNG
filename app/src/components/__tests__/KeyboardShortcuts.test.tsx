/**
 * Coverage for the `?` key branch (refs #246): it must open the floating
 * assistant window when the assistant is enabled, and fall back to the help
 * overlay when it is not. This is the acceptance-criterion line for issue
 * #246 finding 2.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { KeyboardShortcuts } from '../KeyboardShortcuts';
import { useAssistantPanelStore } from '../../stores/assistantPanel';

// The Dialog's open state is a React state update, so the dispatched keydown
// must be wrapped in act() to flush it before asserting on the DOM.
function pressQuestionMark() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
  });
}

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/dashboard' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { monitors: [] } }),
}));
// Prevents transitive loading of stores/profile (log-sanitizer → client), same
// as CommandPalette.test.tsx.
vi.mock('../../api/monitors', () => ({ getMonitors: vi.fn() }));
vi.mock('../../stores/auth', () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) => sel({ isAuthenticated: true }),
}));
vi.mock('../../lib/profile/profile-settings', () => ({ getExcludedMonitorIdSet: () => new Set<string>() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const useCurrentProfileMock = vi.fn(() => ({
  currentProfile: { id: 'p1' },
  settings: { assistantEnabled: false, tvMode: false },
}));
vi.mock('../../hooks/useCurrentProfile', () => ({
  useCurrentProfile: () => useCurrentProfileMock(),
}));

describe('KeyboardShortcuts "?" key', () => {
  beforeEach(() => {
    useCurrentProfileMock.mockReturnValue({
      currentProfile: { id: 'p1' },
      settings: { assistantEnabled: false, tvMode: false },
    });
    useAssistantPanelStore.setState({ state: 'closed', size: { width: 400, height: 560 } });
  });

  it('opens the help overlay and does not open the assistant panel when the assistant is disabled', () => {
    render(<KeyboardShortcuts />);
    pressQuestionMark();

    expect(useAssistantPanelStore.getState().state).toBe('closed');
    expect(screen.getByTestId('keyboard-shortcuts-help')).toBeInTheDocument();
  });

  it('opens the assistant panel and does not open the help overlay when the assistant is enabled', () => {
    useCurrentProfileMock.mockReturnValue({
      currentProfile: { id: 'p1' },
      settings: { assistantEnabled: true, tvMode: false },
    });
    render(<KeyboardShortcuts />);
    pressQuestionMark();

    expect(useAssistantPanelStore.getState().state).toBe('open');
    expect(screen.queryByTestId('keyboard-shortcuts-help')).not.toBeInTheDocument();
  });
});
