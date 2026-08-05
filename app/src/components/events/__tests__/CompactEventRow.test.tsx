import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CompactEventRow } from '../CompactEventRow';
import { useReturnHighlightStore } from '../../../stores/returnHighlight';
import { useDeleteSelectionStore, eventSelectionKey } from '../../../stores/deleteSelection';
import { asProfileId } from '../../../api/types';
import { useProfileStore } from '../../../stores/profile';

const navigate = vi.fn();
// EventDeleteButton probes permissions through React Query; this suite renders
// without a provider and is not about permissions (refs #344).
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ permissions: { events: 'Edit' }, isLoading: false }),
}));

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));
vi.mock('../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtTime: () => '2:19 PM' }),
}));

const base = {
  Id: '233228',
  MonitorId: '4',
  Name: 'FrontDoor-233228',
  Cause: 'Motion:All',
  StartDateTime: '2026-07-02 14:19:00',
  MaxScore: '43',
  Length: '30',
  Notes: 'detected:person|Motion: All',
};

const render1 = (event: typeof base = base) =>
  render(
    <MemoryRouter>
      <CompactEventRow
        event={event as never}
        thumbnailUrls={['http://x/1.jpg']}
        aspectRatio={1.6}
      />
    </MemoryRouter>
  );

describe('CompactEventRow', () => {
  it('shows detection, event id, time, duration and a delete button', () => {
    render1();
    expect(screen.getByText('person')).toBeTruthy();
    expect(screen.getByText(/#233228/)).toBeTruthy();
    expect(screen.getByText(/2:19 PM/)).toBeTruthy();
    expect(screen.getByText('30s')).toBeTruthy();
    expect(screen.queryByText('43')).toBeNull();
    expect(screen.getByTestId('event-delete-button')).toBeTruthy();
  });

  it('falls back to Cause when there is no detection', () => {
    render1({ ...base, Notes: 'Motion: All' });
    expect(screen.getByText('Motion:All')).toBeTruthy();
  });

  it('navigates to the event on row click', () => {
    render1();
    fireEvent.click(screen.getByTestId('compact-event-row'));
    expect(navigate).toHaveBeenCalledWith('/events/233228', { state: { from: '/monitors/4' } });
  });

  it('navigates to the /all/ deep route when a profileId is given (refs #337)', () => {
    render(
      <MemoryRouter>
        <CompactEventRow
          event={base as never}
          thumbnailUrls={['http://x/1.jpg']}
          aspectRatio={1.6}
          profileId={'profile-b' as never}
        />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId('compact-event-row'));
    expect(navigate).toHaveBeenCalledWith('/all/events/profile-b/233228', { state: { from: '/monitors/4' } });
  });

  it('shows the return-flash indicator when returning to this event', () => {
    useReturnHighlightStore.getState().markViewed('233228');
    render1();
    expect(screen.getByTestId('return-flash-indicator')).toBeTruthy();
    useReturnHighlightStore.getState().clear();
  });

  it('does not show the indicator normally', () => {
    useReturnHighlightStore.getState().clear();
    render1();
    expect(screen.queryByTestId('return-flash-indicator')).toBeNull();
  });

  it('marks the row for deletion when its event is queued', () => {
    useDeleteSelectionStore.getState().clear();
    useDeleteSelectionStore.getState().toggle('233228');
    render1();
    const cls = screen.getByTestId('compact-event-row').className;
    expect(cls).toContain('bg-destructive/10');
    expect(cls).toContain('opacity-60');
    useDeleteSelectionStore.getState().clear();
  });

  it('is not marked when the same raw event id is queued on another profile', () => {
    useDeleteSelectionStore.getState().clear();
    useDeleteSelectionStore.getState().toggle(eventSelectionKey(asProfileId('p2'), '233228'));
    render(
      <MemoryRouter>
        <CompactEventRow
          event={base as never}
          thumbnailUrls={['http://x/1.jpg']}
          aspectRatio={1.6}
          profileId={asProfileId('p1')}
          ownerProfileId={asProfileId('p1')}
        />
      </MemoryRouter>
    );
    const cls = screen.getByTestId('compact-event-row').className;
    expect(cls).not.toContain('bg-destructive/10');
    useDeleteSelectionStore.getState().clear();
  });

  // Against the REAL profile store, because the row used to read it: it
  // subscribed to useCurrentProfile purely to rebuild an id its parent was
  // already holding. The owner now arrives as a prop, and the globally
  // current profile has no say in which key this row watches.
  it('keys the selection off the owner prop, not whichever profile is current', () => {
    useProfileStore.setState({
      currentProfileId: asProfileId('p-current'),
      profiles: [{ id: asProfileId('p-current'), name: 'Current' }],
    } as never);
    useDeleteSelectionStore.getState().clear();
    useDeleteSelectionStore.getState().toggle(eventSelectionKey(asProfileId('p1'), '233228'));

    render(
      <MemoryRouter>
        <CompactEventRow
          event={base as never}
          thumbnailUrls={['http://x/1.jpg']}
          aspectRatio={1.6}
          ownerProfileId={asProfileId('p1')}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('compact-event-row').className).toContain('bg-destructive/10');
    useDeleteSelectionStore.getState().clear();
  });
});
