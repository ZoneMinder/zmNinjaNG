import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarContent } from '../SidebarContent';
import { useDeveloperNoticeStore } from '../../../stores/developerNotices';

// The logo is a png asset; give it a stub so the import resolves in jsdom.
// The permission probe is a React Query call; these suites render without a
// provider and are not about permissions (refs #344).
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ permissions: undefined, isLoading: false }),
}));

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

function renderSidebar() {
  return render(
    <MemoryRouter>
      <SidebarContent />
    </MemoryRouter>,
  );
}

describe('SidebarContent developer-notice nav item', () => {
  beforeEach(() => {
    useDeveloperNoticeStore.setState({
      readIds: [],
      dismissedBannerIds: [],
      deletedIds: [],
      showNotices: true,
    });
  });

  it('shows the developer-notice nav item when showNotices is true', () => {
    renderSidebar();
    expect(screen.getByTestId('nav-item-developer-notice')).toBeInTheDocument();
  });

  it('hides the developer-notice nav item when showNotices is false', () => {
    useDeveloperNoticeStore.setState({ showNotices: false });
    renderSidebar();
    expect(screen.queryByTestId('nav-item-developer-notice')).not.toBeInTheDocument();
    // Other nav items remain present.
    expect(screen.getByTestId('nav-item-dashboard')).toBeInTheDocument();
  });
});
