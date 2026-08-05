/**
 * The dashboard page picks the widget bucket for the current selection, and
 * its chrome (refresh + edit toggle) only appears once that bucket holds
 * widgets. Each aggregate keeps its own dashboard, so reading the wrong
 * bucket while a group is active shows an empty dashboard with no way to edit
 * it (refs #337).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Dashboard from '../Dashboard';
import { ALL_PROFILES_ID, mintVirtualProfileId } from '../../api/types';

const widget = {
  id: 'widget-1',
  type: 'events',
  title: 'Recent Events',
  layout: { x: 0, y: 0, w: 4, h: 3 },
  settings: { eventCount: 5 },
};

let widgetBuckets: Record<string, Array<typeof widget>> = {};
let profileState: Record<string, unknown> = {};

vi.mock('../../stores/dashboard', () => ({
  useDashboardStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ widgets: widgetBuckets, isEditing: false, toggleEditMode: vi.fn() }),
}));

vi.mock('../../stores/profile', () => ({
  useProfileStore: (selector: (state: Record<string, unknown>) => unknown) => selector(profileState),
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: unknown) => fn,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The layout and the add-widget dialog have their own suites; this one is
// about which bucket the page reads.
vi.mock('../../components/dashboard/DashboardLayout', () => ({
  DashboardLayout: () => null,
}));
vi.mock('../../components/dashboard/DashboardConfig', () => ({
  DashboardConfig: () => null,
}));
vi.mock('../../components/NotificationBadge', () => ({ NotificationBadge: () => null }));
vi.mock('../../components/common/RefreshButton', () => ({
  RefreshButton: () => <button type="button" data-testid="dashboard-refresh-button" />,
}));

const profile = { id: 'profile-1', name: 'Home' };

describe('Dashboard page', () => {
  beforeEach(() => {
    widgetBuckets = {};
    profileState = {
      profiles: [profile],
      currentProfileId: 'profile-1',
      virtualProfiles: [],
    };
  });

  it("shows the edit chrome for the current profile's own widgets", () => {
    widgetBuckets = { 'profile-1': [widget] };

    render(<Dashboard />);

    expect(screen.getByTestId('dashboard-edit-toggle')).toBeInTheDocument();
  });

  it("reads the active group's own bucket, not the ALL sentinel's", () => {
    const group = mintVirtualProfileId();
    widgetBuckets = { [group]: [widget], [ALL_PROFILES_ID]: [] };
    profileState = {
      profiles: [profile],
      currentProfileId: group,
      virtualProfiles: [{ id: group, name: 'Backyard', memberProfileIds: ['profile-1'] }],
    };

    render(<Dashboard />);

    expect(screen.getByTestId('dashboard-edit-toggle')).toBeInTheDocument();
  });

  it('shows no edit chrome when the active bucket is empty', () => {
    const group = mintVirtualProfileId();
    widgetBuckets = { [ALL_PROFILES_ID]: [widget] };
    profileState = {
      profiles: [profile],
      currentProfileId: group,
      virtualProfiles: [{ id: group, name: 'Backyard', memberProfileIds: ['profile-1'] }],
    };

    render(<Dashboard />);

    expect(screen.queryByTestId('dashboard-edit-toggle')).not.toBeInTheDocument();
  });
});
