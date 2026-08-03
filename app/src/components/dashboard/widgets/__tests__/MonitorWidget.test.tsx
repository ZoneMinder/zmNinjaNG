import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MonitorWidget } from '../MonitorWidget';
import { useProfileById } from '../../../../hooks/useCurrentProfile';
import { getSession } from '../../../../services/sessions';
import { getMonitor, getMonitors } from '../../../../api/monitors';
import { asProfileId } from '../../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../../hooks/useCurrentProfile', () => ({
  useProfileById: vi.fn(),
}));
vi.mock('../../../../services/sessions', () => ({
  getSession: vi.fn(),
}));
vi.mock('../../../../api/monitors', () => ({
  getMonitor: vi.fn(),
  getMonitors: vi.fn(),
}));
vi.mock('../../../monitors/LiveMonitorPlayer', () => ({
  LiveMonitorPlayer: ({ profileId }: { profileId?: string }) => (
    <div data-testid="live-player" data-profile-id={profileId ?? ''} />
  ),
}));
vi.mock('../../../monitors/MonitorHoverPreview', () => ({
  MonitorHoverPreview: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const profileA = { id: asProfileId('profile-a'), name: 'Home' };
const profileB = { id: asProfileId('profile-b'), name: 'Work' };

const settings = { hoverPreview: { dashboard: false }, showProtocolLabel: false };

function clientFor(id: string) {
  return { profile: id } as unknown as import('../../../../api/client').ApiClient;
}

function renderWidget(profileId?: import('../../../../api/types').ProfileId) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MonitorWidget monitorIds={['7']} profileId={profileId} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MonitorWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMonitors).mockImplementation(async (client) => {
      const id = (client as unknown as { profile: string }).profile;
      return { monitors: [{ Monitor: { Id: '7', Name: `Cam-${id}`, Deleted: false } }] } as never;
    });
    vi.mocked(getMonitor).mockImplementation(async (client) => {
      const id = (client as unknown as { profile: string }).profile;
      return { Monitor: { Id: '7', Name: `Cam-${id}`, Deleted: false } } as never;
    });
    vi.mocked(getSession).mockImplementation((id) => ({
      profileId: id,
      client: clientFor(id),
      timezone: 'UTC',
    }));
  });

  it('single mode (no profileId prop): fetches via the current profile, no chip', async () => {
    vi.mocked(useProfileById).mockReturnValue({ profile: profileA, settings } as never);

    renderWidget(undefined);

    await waitFor(() => expect(screen.getByTestId('live-player')).toBeInTheDocument());
    expect(getSession).toHaveBeenCalledWith(profileA.id);
    expect(screen.queryByTestId('widget-profile-chip')).toBeNull();
  });

  it('picker widget: given profileId=B, fetches the monitor via profile B\'s client, not the current profile\'s (refs #337)', async () => {
    vi.mocked(useProfileById).mockImplementation((id) => ({
      profile: id === profileB.id ? profileB : profileA,
      settings,
    } as never));

    renderWidget(profileB.id);

    await waitFor(() => expect(getMonitor).toHaveBeenCalled());
    // The client passed to getMonitor is the one getSession(profileB.id) built.
    expect(getSession).toHaveBeenCalledWith(profileB.id);
    expect(getSession).not.toHaveBeenCalledWith(profileA.id);
    const [client] = vi.mocked(getMonitor).mock.calls[0];
    expect((client as unknown as { profile: string }).profile).toBe(profileB.id);

    await waitFor(() => expect(screen.getByTestId('widget-profile-chip')).toHaveTextContent('Work'));
    // LiveMonitorPlayer's own profileId prop (distinct from `profile`) scopes
    // its go2rtc failure cache / MJPEG token resolution to the OWNING
    // profile, not whichever profile is globally selected (refs #337).
    expect(screen.getByTestId('live-player')).toHaveAttribute('data-profile-id', profileB.id);
  });
});
