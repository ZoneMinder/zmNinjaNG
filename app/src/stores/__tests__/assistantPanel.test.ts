/**
 * assistantPanel store tests (refs #246): the open/minimized/closed state
 * machine, size clamping, and the partialize contract that persists only
 * `size` (never `state`) across a reload.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAssistantPanelStore } from '../assistantPanel';
import { ASSISTANT_PANEL, STORAGE_KEYS } from '../../lib/zmninja-ng-constants';

describe('useAssistantPanelStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAssistantPanelStore.setState({
      state: 'closed',
      size: { width: ASSISTANT_PANEL.defaultWidth, height: ASSISTANT_PANEL.defaultHeight },
    });
  });

  it('defaults to closed with the default size', () => {
    const state = useAssistantPanelStore.getState();
    expect(state.state).toBe('closed');
    expect(state.size).toEqual({ width: ASSISTANT_PANEL.defaultWidth, height: ASSISTANT_PANEL.defaultHeight });
  });

  it('open() sets state to open', () => {
    useAssistantPanelStore.getState().open();
    expect(useAssistantPanelStore.getState().state).toBe('open');
  });

  it('minimize() sets state to minimized', () => {
    useAssistantPanelStore.getState().open();
    useAssistantPanelStore.getState().minimize();
    expect(useAssistantPanelStore.getState().state).toBe('minimized');
  });

  it('close() sets state to closed', () => {
    useAssistantPanelStore.getState().open();
    useAssistantPanelStore.getState().close();
    expect(useAssistantPanelStore.getState().state).toBe('closed');
  });

  it('setSize() updates width and height within bounds', () => {
    useAssistantPanelStore.getState().setSize(500, 600);
    expect(useAssistantPanelStore.getState().size).toEqual({ width: 500, height: 600 });
  });

  it('setSize() clamps below the minimum', () => {
    useAssistantPanelStore.getState().setSize(10, 10);
    expect(useAssistantPanelStore.getState().size).toEqual({
      width: ASSISTANT_PANEL.minWidth,
      height: ASSISTANT_PANEL.minHeight,
    });
  });

  it('setSize() clamps above the maximum', () => {
    useAssistantPanelStore.getState().setSize(5000, 5000);
    expect(useAssistantPanelStore.getState().size).toEqual({
      width: ASSISTANT_PANEL.maxWidth,
      height: ASSISTANT_PANEL.maxHeight,
    });
  });

  it('persists only size, never the open/minimized/closed state', () => {
    useAssistantPanelStore.getState().open();
    useAssistantPanelStore.getState().setSize(444, 555);

    const raw = localStorage.getItem(STORAGE_KEYS.assistantPanelStore);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.size).toEqual({ width: 444, height: 555 });
    expect(parsed.state.state).toBeUndefined();
  });
});
