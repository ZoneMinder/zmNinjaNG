/**
 * Streaming Mode recommendation (refs #385)
 *
 * The row's "Recommended" badge and the reason line under it come from the
 * server, not from a hardcoded mode: how many monitors compete for live
 * connections, and whether multi-port streaming lifts that limit. What is
 * asserted here is the reason the user reads and which side of the toggle the
 * badge sits on, since those are what tell them why the mode was picked.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LiveStreamingSection } from '../LiveStreamingSection';
import { DEFAULT_SETTINGS } from '../../../stores/settings';
import { asProfileId, type Profile } from '../../../api/types';
import { getMonitors } from '../../../api/monitors';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && typeof params === 'object' && !('defaultValue' in params)
        ? `${key}:${JSON.stringify(params)}`
        : key,
  }),
}));

vi.mock('../../../api/monitors', () => ({ getMonitors: vi.fn() }));
vi.mock('../../../services/sessions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/sessions')>()),
  getSession: () => ({ client: {} }) as never,
}));

const profile = (minStreamingPort?: number): Profile => ({
  id: asProfileId('p1'),
  name: 'Test',
  portalUrl: 'https://zm.example.com',
  apiUrl: 'https://zm.example.com/api',
  cgiUrl: 'https://zm.example.com/cgi-bin',
  isDefault: true,
  createdAt: 0,
  minStreamingPort,
});

async function renderSection(
  monitorCount: number,
  minStreamingPort?: number,
  settings: Partial<typeof DEFAULT_SETTINGS> = {},
) {
  vi.mocked(getMonitors).mockResolvedValue({
    monitors: Array.from({ length: monitorCount }, (_, i) => ({ id: String(i + 1) })),
  } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LiveStreamingSection
        settings={{ ...DEFAULT_SETTINGS, ...settings }}
        update={vi.fn()}
        currentProfile={profile(minStreamingPort)}
        updateSettings={vi.fn()}
      />
    </QueryClientProvider>
  );
  return screen.findByTestId('settings-view-mode-reason');
}

describe('LiveStreamingSection Streaming Mode recommendation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('explains streaming for a small server and badges the streaming side', async () => {
    const reason = await renderSection(3);
    expect(reason.textContent).toBe(
      'settings.view_mode_reason_few_monitors:{"monitorCount":3}'
    );
    expect(screen.getByTestId('settings-view-mode-recommended-streaming')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-view-mode-recommended-snapshot')).toBeNull();
  });

  it('explains streaming for a big server with multi-port', async () => {
    const reason = await renderSection(20, 31000);
    expect(reason.textContent).toBe(
      'settings.view_mode_reason_multi_port:{"monitorCount":20}'
    );
  });

  it('drops back to snapshot when the profile force-disables multi-port', async () => {
    const reason = await renderSection(20, 31000, { forceDisableMultiPort: true });
    expect(reason.textContent).toBe(
      'settings.view_mode_reason_many_monitors:{"monitorCount":20}'
    );
    expect(screen.getByTestId('settings-view-mode-recommended-snapshot')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-view-mode-recommended-streaming')).toBeNull();
  });
});
