import { describe, it, expect, beforeEach } from 'vitest';
import { useReturnHighlightStore } from '../returnHighlight';

describe('useReturnHighlightStore', () => {
  beforeEach(() => useReturnHighlightStore.getState().clear());

  it('starts empty', () => {
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBeNull();
  });
  it('markViewed sets the id', () => {
    useReturnHighlightStore.getState().markViewed('42');
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBe('42');
  });
  it('clear nulls the id', () => {
    useReturnHighlightStore.getState().markViewed('42');
    useReturnHighlightStore.getState().clear();
    expect(useReturnHighlightStore.getState().lastViewedEventId).toBeNull();
  });
});
