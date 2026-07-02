import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CompactEventRow } from '../CompactEventRow';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../hooks/useDateTimeFormat', () => ({
  useDateTimeFormat: () => ({ fmtTime: () => '2:19 PM' }),
}));

const event = {
  Id: '233228',
  MonitorId: '4',
  Name: 'FrontDoor-233228',
  Cause: 'Motion:All',
  StartDateTime: '2026-07-02 14:19:00',
  MaxScore: '43',
} as never;

describe('CompactEventRow', () => {
  it('shows cause, time, and score, and navigates on click', () => {
    render(
      <MemoryRouter>
        <CompactEventRow event={event} thumbnailUrls={['http://x/1.jpg']} aspectRatio={1.6} />
      </MemoryRouter>
    );
    expect(screen.getByText('Motion:All')).toBeTruthy();
    expect(screen.getByText('2:19 PM')).toBeTruthy();
    expect(screen.getByText('43')).toBeTruthy();
    fireEvent.click(screen.getByTestId('compact-event-row'));
    expect(navigate).toHaveBeenCalledWith('/events/233228', {
      state: { from: '/monitors/4' },
    });
  });
});
