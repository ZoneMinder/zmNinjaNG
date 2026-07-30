import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarContent } from '../SidebarContent';
import { useProfileStore } from '../../../stores/profile';
import { useSettingsStore } from '../../../stores/settings';
import { useNotificationStore } from '../../../stores/notifications';

// The logo is a png asset; give it a stub so the import resolves in jsdom.
vi.mock('../../../../assets/logo.png', () => ({ default: 'logo.png' }));

// Side-effecting hooks the sidebar pulls in; stub them to keep the render pure.
vi.mock('../../../hooks/useDeveloperNotices', () => ({
  useDeveloperNotices: () => ({ unreadCount: 0 }),
}));
vi.mock('../../../hooks/useTvMode', () => ({
  useTvMode: () => ({ isTvMode: false }),
}));
vi.mock('../../../hooks/useKioskLock', () => ({
  useKioskLock: () => ({
    isLocked: false,
    showSetPin: false,
    setPinMode: 'set',
    pinError: null,
    handleLockToggle: vi.fn(),
    handleSetPinSubmit: vi.fn(),
    handleSetPinCancel: vi.fn(),
  }),
}));
vi.mock('../../../hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, d?: string) => d ?? k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

/** An alarm this many seconds ago, i.e. older than the 30s default dwell. */
function eventAgedSeconds(monitorId: string, seconds: number) {
  return { MonitorId: monitorId, receivedAt: Date.now() - seconds * 1000 };
}

function setDwellSeconds(seconds: number) {
  useSettingsStore.getState().updateProfileSettings('p1', {
    liveActivityDwellSeconds: seconds,
  });
}

function renderSidebar() {
  return render(
    <MemoryRouter>
      <SidebarContent />
    </MemoryRouter>
  );
}

describe('SidebarContent Live Activity badge', () => {
  beforeEach(() => {
    useProfileStore.setState({
      profiles: [{ id: 'p1', name: 'Home', portalUrl: 'https://zm.test' }] as never,
      currentProfileId: 'p1' as never,
    });
    useNotificationStore.setState({ profileEvents: {} });
  });

  it('counts an alarm inside the profile dwell window and not one outside it', () => {
    setDwellSeconds(60);
    useNotificationStore.setState({
      profileEvents: { p1: [eventAgedSeconds('3', 10), eventAgedSeconds('4', 120)] as never },
    });

    renderSidebar();

    expect(screen.getByTestId('live-activity-nav-badge')).toHaveTextContent('1');
  });

  it('honours a dwell window longer than the default rather than the 30s default', () => {
    // Regression: the badge hardcoded LIVE_ACTIVITY.defaultDwellSeconds, so a
    // user with a long dwell got a 30s badge window and the badge disappeared
    // while the page still showed the tile.
    setDwellSeconds(300);
    useNotificationStore.setState({
      profileEvents: { p1: [eventAgedSeconds('3', 100), eventAgedSeconds('4', 200)] as never },
    });

    renderSidebar();

    expect(screen.getByTestId('live-activity-nav-badge')).toHaveTextContent('2');
  });

  it('shows no badge when every alarm has aged out of the window', () => {
    setDwellSeconds(30);
    useNotificationStore.setState({
      profileEvents: { p1: [eventAgedSeconds('3', 100)] as never },
    });

    renderSidebar();

    expect(screen.queryByTestId('live-activity-nav-badge')).not.toBeInTheDocument();
  });
});
