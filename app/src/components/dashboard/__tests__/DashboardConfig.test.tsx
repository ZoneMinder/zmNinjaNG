import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../api/store-gates', () => import('../../../tests/fake-store-gates'));
vi.mock('../../../lib/security/secureStorage', () => import('../../../tests/fake-secure-storage'));

import { DashboardConfig } from '../DashboardConfig';
import { mintVirtualProfileId } from '../../../api/types';
import { seedProfiles, resetProfileFixture, makeProfile } from '../../../tests/profile-fixture';
import { resetFakeStoreGates } from '../../../tests/fake-store-gates';
import { useProfileStore } from '../../../stores/profile';

const addWidget = vi.fn();

vi.mock('../../../stores/dashboard', () => ({
  useDashboardStore: (selector: (state: { addWidget: typeof addWidget }) => unknown) =>
    selector({ addWidget }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      monitors: [
        { Monitor: { Id: '1', Name: 'Front Door', Deleted: false } },
        { Monitor: { Id: '2', Name: 'Back Door', Deleted: false } },
      ],
    },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('DashboardConfig', () => {
  beforeEach(() => {
    addWidget.mockClear();
    seedProfiles([makeProfile('profile-1', { name: 'Home' })]);
  });

  afterEach(() => {
    resetProfileFixture();
    resetFakeStoreGates();
  });

  it('adds a monitor widget when a monitor is selected', () => {
    render(<DashboardConfig />);

    fireEvent.click(screen.getByTestId('add-widget-trigger'));
    fireEvent.click(screen.getByTestId('monitor-checkbox-1'));
    fireEvent.change(screen.getByTestId('widget-title-input'), {
      target: { value: 'My Monitor' },
    });
    fireEvent.click(screen.getByTestId('widget-add-button'));

    expect(addWidget).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({
        type: 'monitor',
        title: 'My Monitor',
        settings: { monitorIds: ['1'], feedFit: 'contain' },
      })
    );
  });

  it('adds an events widget without requiring a monitor selection', () => {
    render(<DashboardConfig />);

    fireEvent.click(screen.getByTestId('add-widget-trigger'));
    fireEvent.click(screen.getByTestId('widget-type-events'));
    fireEvent.click(screen.getByTestId('widget-add-button'));

    expect(addWidget).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({
        type: 'events',
        settings: { monitorId: undefined, eventCount: 5 },
      })
    );
  });

  // Each aggregate keeps its own dashboard, so a widget added while a group is
  // active is filed under the group, not the All Servers sentinel (refs #337).
  it("files a new widget under the active group's own bucket", () => {
    const group = mintVirtualProfileId();
    useProfileStore.setState({
      currentProfileId: group,
      virtualProfiles: [{ id: group, name: 'Backyard', memberProfileIds: [asProfileId('profile-1')] }],
    });

    render(<DashboardConfig />);

    fireEvent.click(screen.getByTestId('add-widget-trigger'));
    fireEvent.click(screen.getByTestId('widget-type-events'));
    fireEvent.click(screen.getByTestId('widget-add-button'));

    expect(addWidget).toHaveBeenCalledWith(group, expect.objectContaining({ type: 'events' }));
  });
});
