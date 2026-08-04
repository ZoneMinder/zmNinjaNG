/**
 * Sidebar chrome in All Servers mode (refs #337).
 *
 * Every control here is a view-level preference, so All mode reads and writes
 * the ALL bucket through the sentinel profile id rather than going inert
 * because currentProfile is null. Real stores throughout: the icons read
 * settings reactively, and a mocked store would hide a stale-icon bug.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarContent } from '../SidebarContent';
import { useProfileStore } from '../../../stores/profile';
import { useSettingsStore } from '../../../stores/settings';
import { useDeveloperNoticeStore } from '../../../stores/developerNotices';
import { ALL_PROFILES_ID, asProfileId } from '../../../api/types';
import type { Profile } from '../../../api/types';

vi.mock('../../../../assets/logo.png', () => ({ default: 'logo.png' }));

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

const profile = (id: string, name: string): Profile => ({
  id: asProfileId(id),
  name,
  portalUrl: 'http://localhost',
  apiUrl: 'http://localhost/api',
  cgiUrl: 'http://localhost/cgi-bin',
  isDefault: false,
  createdAt: 0,
});

const allBucket = () => useSettingsStore.getState().getProfileSettings(ALL_PROFILES_ID);

function renderSidebar(route = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SidebarContent />
    </MemoryRouter>,
  );
}

describe('SidebarContent in All Servers mode', () => {
  beforeEach(() => {
    useDeveloperNoticeStore.setState({
      readIds: [],
      dismissedBannerIds: [],
      deletedIds: [],
      showNotices: true,
    });
    useSettingsStore.setState({ profileSettings: {} });
    useProfileStore.setState({
      profiles: [profile('profile-1', 'Home'), profile('profile-2', 'Office')],
      currentProfileId: ALL_PROFILES_ID,
    });
  });

  it('persists the insomnia toggle into the ALL bucket', () => {
    renderSidebar();

    fireEvent.click(screen.getByTestId('sidebar-insomnia-toggle'));

    expect(allBucket().insomnia).toBe(true);
  });

  // The icon used to read a null profile's settings while the page read the
  // ALL bucket, so it showed "off" over an on setting.
  it('shows the ALL bucket insomnia state on the toggle', () => {
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { insomnia: true });

    renderSidebar();

    expect(screen.getByTestId('sidebar-insomnia-toggle')).toHaveAttribute(
      'title',
      'montage.insomnia_enabled',
    );
  });

  it('persists a nav-order reset into the ALL bucket', () => {
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, {
      sidebarNavOrder: ['/events', '/dashboard'],
    });

    renderSidebar();
    fireEvent.click(screen.getByTestId('nav-reorder-toggle'));
    fireEvent.click(screen.getByTestId('nav-reorder-reset'));

    expect(allBucket().sidebarNavOrder).toEqual([]);
  });

  it('orders nav items from the ALL bucket', () => {
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, {
      sidebarNavOrder: ['/events', '/dashboard'],
    });

    renderSidebar();

    const items = screen.getAllByTestId(/^nav-item-/);
    expect(items[0]).toHaveAttribute('data-testid', 'nav-item-events');
  });

  it('persists the montage toolbar toggle into the ALL bucket and flips its icon', () => {
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, {
      montageShowToolbar: true,
    });

    renderSidebar('/montage');
    const toggle = screen.getByTestId('sidebar-montage-toolbar-toggle');
    // Eye (shown) vs EyeOff (hidden): the page reads the ALL bucket, so the
    // icon has to as well.
    expect(toggle.querySelector('.lucide-eye')).not.toBeNull();

    fireEvent.click(toggle);

    expect(allBucket().montageShowToolbar).toBe(false);
    expect(
      screen.getByTestId('sidebar-montage-toolbar-toggle').querySelector('.lucide-eye-off'),
    ).not.toBeNull();
  });
});
