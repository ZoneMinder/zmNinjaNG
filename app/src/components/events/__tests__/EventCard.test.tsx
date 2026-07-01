import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { EventCard } from '../EventCard';

const navigate = vi.fn();

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../../lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    api: vi.fn(),
    auth: vi.fn(),
    profile: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

// Base event object with all required fields. Accepts overrides for specific fields.
const baseEvent = {
  Id: '101',
  MonitorId: '1',
  StorageId: null,
  SecondaryStorageId: null,
  Name: 'Motion Event',
  Cause: 'Motion',
  StartDateTime: '2024-01-01 10:00:00',
  EndDateTime: null,
  Width: '640',
  Height: '480',
  Length: '12',
  Frames: '120',
  AlarmFrames: '5',
  AlarmFrameId: '1',
  MaxScoreFrameId: '2',
  DefaultVideo: null,
  SaveJPEGs: '0',
  TotScore: '10',
  AvgScore: '1',
  MaxScore: '3',
  Archived: '0',
  Videoed: '0',
  Uploaded: '0',
  Emailed: '0',
  Messaged: '0',
  Executed: '0',
  Notes: null,
  StateId: null,
  Orientation: null,
  DiskSpace: null,
  Scheme: null,
};

function makeEvent(overrides: Partial<typeof baseEvent>) {
  return { ...baseEvent, ...overrides };
}

function renderEventCard(eventOverrides: Partial<typeof baseEvent> = {}) {
  return renderWithClient(
    <EventCard
      event={makeEvent(eventOverrides)}
      monitorName="Front Door"
      thumbnailUrls={['https://example.test/thumb.jpg']}
      thumbnailWidth={160}
      thumbnailHeight={120}
    />
  );
}

describe('EventCard', () => {
  beforeEach(() => {
    navigate.mockClear();
  });

  it('renders event details and thumbnail', () => {
    renderWithClient(
      <EventCard
        event={{
          Id: '101',
          MonitorId: '1',
          StorageId: null,
          SecondaryStorageId: null,
          Name: 'Motion Event',
          Cause: 'Motion',
          StartDateTime: '2024-01-01 10:00:00',
          EndDateTime: null,
          Width: '640',
          Height: '480',
          Length: '12',
          Frames: '120',
          AlarmFrames: '5',
          AlarmFrameId: '1',
          MaxScoreFrameId: '2',
          DefaultVideo: null,
          SaveJPEGs: '0',
          TotScore: '10',
          AvgScore: '1',
          MaxScore: '3',
          Archived: '0',
          Videoed: '0',
          Uploaded: '0',
          Emailed: '0',
          Messaged: '0',
          Executed: '0',
          Notes: null,
          StateId: null,
          Orientation: null,
          DiskSpace: null,
          Scheme: null,
        }}
        monitorName="Front Door"
        thumbnailUrls={["https://example.test/thumb.jpg"]}
        thumbnailWidth={160}
        thumbnailHeight={120}
      />
    );

    expect(screen.getByTestId('event-card')).toBeInTheDocument();
    expect(screen.getByTestId('event-thumbnail')).toBeInTheDocument();
    expect(screen.getByTestId('event-monitor-name')).toHaveTextContent('Front Door');
  });

  it('navigates to event details on click', () => {
    renderWithClient(
      <EventCard
        event={{
          Id: '202',
          MonitorId: '1',
          StorageId: null,
          SecondaryStorageId: null,
          Name: 'Door',
          Cause: 'Motion',
          StartDateTime: '2024-01-01 10:00:00',
          EndDateTime: null,
          Width: '640',
          Height: '480',
          Length: '12',
          Frames: '120',
          AlarmFrames: '5',
          AlarmFrameId: '1',
          MaxScoreFrameId: '2',
          DefaultVideo: null,
          SaveJPEGs: '0',
          TotScore: '10',
          AvgScore: '1',
          MaxScore: '3',
          Archived: '0',
          Videoed: '0',
          Uploaded: '0',
          Emailed: '0',
          Messaged: '0',
          Executed: '0',
          Notes: null,
          StateId: null,
          Orientation: null,
          DiskSpace: null,
          Scheme: null,
        }}
        monitorName="Front Door"
        thumbnailUrls={["https://example.test/thumb.jpg"]}
        thumbnailWidth={160}
        thumbnailHeight={120}
      />
    );

    fireEvent.click(screen.getByTestId('event-card'));

    expect(navigate).toHaveBeenCalledWith('/events/202', { state: { from: '/events', eventFilters: undefined } });
  });

  it('shows a relative-time chip for a recent event', () => {
    const recent = new Date(Date.now() - 40 * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${recent.getFullYear()}-${pad(recent.getMonth() + 1)}-${pad(recent.getDate())} ${pad(recent.getHours())}:${pad(recent.getMinutes())}:${pad(recent.getSeconds())}`;
    renderEventCard({ StartDateTime: start });
    expect(screen.getByTestId('event-relative-time')).toBeInTheDocument();
  });

  it('hides the relative-time chip for an event older than the window', () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${old.getFullYear()}-${pad(old.getMonth() + 1)}-${pad(old.getDate())} ${pad(old.getHours())}:${pad(old.getMinutes())}:${pad(old.getSeconds())}`;
    renderEventCard({ StartDateTime: start });
    expect(screen.queryByTestId('event-relative-time')).not.toBeInTheDocument();
  });
});
