/**
 * App chrome in All Servers mode (refs #337).
 *
 * Sidebar collapse, the mobile montage toolbar toggle, the kiosk insomnia
 * restore and TV auto-detect are all view-level preferences, so they read and
 * write the ALL bucket through the sentinel instead of going inert because
 * currentProfile is null. Real profile/settings stores so the assertions are
 * on stored values.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppLayout from '../AppLayout';
import { useProfileStore } from '../../../stores/profile';
import { useSettingsStore } from '../../../stores/settings';
import { useKioskStore } from '../../../stores/kioskStore';
import { ALL_PROFILES_ID, asProfileId, mintVirtualProfileId } from '../../../api/types';
import type { Profile } from '../../../api/types';

vi.mock('../../../../assets/logo.png', () => ({ default: 'logo.png' }));

const checkIsTVMock = vi.fn(async () => false);
vi.mock('../../../lib/tv/tv-spatial-nav', () => ({
  checkIsTV: () => checkIsTVMock(),
  enableSpatialNavigation: vi.fn(),
}));

vi.mock('../../../hooks/useInsomnia', () => ({ useInsomnia: vi.fn() }));
vi.mock('../../../hooks/useReconcileDeletedMonitors', () => ({
  useReconcileDeletedMonitors: vi.fn(),
}));
vi.mock('../../../hooks/useTvMode', () => ({ useTvMode: () => ({ isTvMode: false }) }));
// Which aggregate is active. Mutable so a test can swap All Servers for a
// named group, whose bucket is a different key in the same settings map.
let scopeMock: Record<string, unknown> = {};
vi.mock('../../../hooks/useProfileScope', () => ({
  useProfileScope: () => scopeMock,
}));

vi.mock('../SidebarContent', () => ({ SidebarContent: () => <div /> }));
vi.mock('../DeveloperNoticeBanner', () => ({ DeveloperNoticeBanner: () => null }));
vi.mock('../OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('../../BackgroundTaskDrawer', () => ({ BackgroundTaskDrawer: () => null }));
vi.mock('../../CertTrustDialog', () => ({ CertTrustDialog: () => null }));
vi.mock('../../CertTrustBanner', () => ({ CertTrustBanner: () => null }));
vi.mock('../../events/DeleteBatchBar', () => ({ DeleteBatchBar: () => null }));
vi.mock('../../assistant/AssistantWidget', () => ({ AssistantWidget: () => null }));

// The overlay only renders while locked; expose its unlock callback directly so
// the restore path is reachable without driving the PIN pad.
vi.mock('../../kiosk/KioskOverlay', () => ({
  KioskOverlay: ({ onUnlock }: { onUnlock: () => void }) => (
    <button data-testid="kiosk-unlock-stub" onClick={onUnlock} />
  ),
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

const renderLayout = (route = '/dashboard') =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <AppLayout />
    </MemoryRouter>,
  );

describe('AppLayout in All Servers mode', () => {
  beforeEach(() => {
    checkIsTVMock.mockReset();
    checkIsTVMock.mockResolvedValue(false);
    scopeMock = { mode: 'all', profiles: [], aggregateId: ALL_PROFILES_ID, aggregateName: null };
    useSettingsStore.setState({ profileSettings: {} });
    useProfileStore.setState({
      profiles: [profile('profile-1', 'Home'), profile('profile-2', 'Office')],
      currentProfileId: ALL_PROFILES_ID,
      virtualProfiles: [],
    });
    useKioskStore.setState({ isLocked: false, previousInsomniaState: false });
  });

  it('persists a sidebar collapse into the ALL bucket', () => {
    renderLayout();

    fireEvent.click(screen.getByTestId('sidebar-toggle'));

    expect(allBucket().sidebarWidth).toBe(60);
  });

  it('persists the mobile montage toolbar toggle into the ALL bucket', () => {
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, {
      montageShowToolbar: true,
    });

    renderLayout('/montage');
    fireEvent.click(screen.getByTestId('montage-toolbar-toggle'));

    expect(allBucket().montageShowToolbar).toBe(false);
  });

  // useKioskLock already stores the LOCK against the sentinel, so an unlock
  // that skipped it left insomnia stuck on after leaving kiosk mode.
  it('restores the pre-kiosk insomnia state into the ALL bucket on unlock', () => {
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { insomnia: true });
    useKioskStore.setState({ isLocked: true, previousInsomniaState: false });

    renderLayout();
    fireEvent.click(screen.getByTestId('kiosk-unlock-stub'));

    expect(allBucket().insomnia).toBe(false);
  });

  it('remembers the last route in the ALL bucket', () => {
    renderLayout('/montage');

    expect(allBucket().lastRoute).toBe('/montage');
  });

  // Each aggregate remembers its own page: reopening a group must not send
  // the user back to wherever All Servers was left.
  it("remembers the last route in the active group's bucket, not the ALL sentinel's", () => {
    const group = mintVirtualProfileId();
    useSettingsStore.getState().updateProfileSettings(ALL_PROFILES_ID, { lastRoute: '/events' });
    scopeMock = { mode: 'all', profiles: [], aggregateId: group, aggregateName: 'Backyard' };
    useProfileStore.setState({
      currentProfileId: group,
      virtualProfiles: [{ id: group, name: 'Backyard', memberProfileIds: [asProfileId('profile-1')] }],
    });

    renderLayout('/montage');

    expect(useSettingsStore.getState().getProfileSettings(group).lastRoute).toBe('/montage');
    expect(allBucket().lastRoute).toBe('/events');
  });

  it('persists TV auto-detection into the ALL bucket', async () => {
    checkIsTVMock.mockResolvedValue(true);

    renderLayout();

    await waitFor(() => expect(allBucket().tvMode).toBe(true));
  });
});
