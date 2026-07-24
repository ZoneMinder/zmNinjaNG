/**
 * useAssistantHost tests (refs #246): `navigate()` must minimize the
 * floating assistant panel before routing, so an "Open" result-card click
 * collapses the panel to the FAB instead of unmounting the conversation
 * underneath it.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAssistantHost } from '../useAssistantHost';
import { useAssistantPanelStore } from '../../../stores/assistantPanel';
import { ASSISTANT_PANEL } from '../../../lib/zmninja-ng-constants';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

describe('useAssistantHost', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    useAssistantPanelStore.setState({
      state: 'open',
      size: { width: ASSISTANT_PANEL.defaultWidth, height: ASSISTANT_PANEL.defaultHeight },
    });
  });

  it('navigate() minimizes the panel before routing', () => {
    const { result } = renderHook(() => useAssistantHost());

    act(() => {
      result.current.host.navigate('/monitors/12');
    });

    expect(useAssistantPanelStore.getState().state).toBe('minimized');
    expect(navigateMock).toHaveBeenCalledWith('/monitors/12');
  });

});
