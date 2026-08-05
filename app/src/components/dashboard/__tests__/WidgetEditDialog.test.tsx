import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { WidgetEditDialog } from '../WidgetEditDialog';
import { useProfileScope } from '../../../hooks/useProfileScope';
import { getSession } from '../../../services/sessions';
import { getMonitors } from '../../../api/monitors';
import { asProfileId } from '../../../api/types';
import type { DashboardWidget } from '../../../stores/dashboard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../../../hooks/useProfileScope', () => ({
  useProfileScope: vi.fn(),
}));
vi.mock('../../../services/sessions', () => ({
  getSession: vi.fn(),
  getCurrentSession: vi.fn(),
  // useEventTags is mocked below, but stores/profile.ts (pulled in via other
  // real hooks in the import graph) calls this at module load time.
  registerSessionsGate: vi.fn(),
}));
vi.mock('../../../api/monitors', () => ({
  getMonitors: vi.fn(),
}));
vi.mock('../../../hooks/useEventTags', () => ({
  useEventTags: () => ({ availableTags: [], tagsSupported: false }),
}));

// Radix's Select relies on portals/pointer APIs jsdom doesn't fully support -
// same stub approach as Settings.test.tsx.
const SelectContext = createContext<{ onValueChange?: (value: string) => void }>({});
vi.mock('../../ui/select', () => ({
  Select: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (value: string) => void }) => (
    <SelectContext.Provider value={{ onValueChange }}>{children}</SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => {
    const ctx = useContext(SelectContext);
    return (
      <button type="button" onClick={() => ctx.onValueChange?.(value)}>{children}</button>
    );
  },
}));

const updateWidget = vi.fn();
vi.mock('../../../stores/dashboard', () => ({
  useDashboardStore: (selector: (s: { updateWidget: typeof updateWidget }) => unknown) =>
    selector({ updateWidget }),
}));

const profileA = { id: asProfileId('profile-a'), name: 'Home' };
const profileB = { id: asProfileId('profile-b'), name: 'Work' };

const widget: DashboardWidget = {
  id: 'widget-1',
  type: 'monitor',
  title: 'Front',
  settings: { monitorIds: ['1'] },
  layout: { i: 'widget-1', x: 0, y: 0, w: 4, h: 2 },
};

function clientFor(id: string) {
  return { profile: id } as unknown as import('../../../api/client').ApiClient;
}

describe('WidgetEditDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProfileScope).mockReturnValue({
      mode: 'all',
      profile: null,
      profiles: [profileA, profileB],
      settings: {},
    } as never);
    vi.mocked(getSession).mockImplementation((id) => ({ profileId: id, client: clientFor(id), timezone: 'UTC' }));
    vi.mocked(getMonitors).mockImplementation(async (client) => {
      const id = (client as unknown as { profile: string }).profile;
      return { monitors: [{ Monitor: { Id: '1', Name: `Cam-${id}`, Deleted: false } }] } as never;
    });
  });

  it('picking profile B and saving pins the monitor widget to B (refs #337)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WidgetEditDialog open onOpenChange={() => {}} widget={widget} profileId={profileA.id} />
      </QueryClientProvider>
    );

    // Default picks the first profile in scope (A); switch to B. The widget
    // already has monitorIds: ['1'] selected, so the save button stays
    // enabled without touching the monitor checkboxes.
    expect(screen.getByTestId('widget-profile-picker')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Work')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Work'));

    await waitFor(() => expect(screen.getByTestId('widget-edit-monitor-checkbox-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('widget-edit-save-button'));

    expect(updateWidget).toHaveBeenCalledWith(
      profileA.id,
      'widget-1',
      expect.objectContaining({ settings: expect.objectContaining({ profileId: profileB.id }) })
    );
  });
});
