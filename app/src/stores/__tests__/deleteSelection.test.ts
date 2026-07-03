import { describe, it, expect, beforeEach } from 'vitest';
import { useDeleteSelectionStore } from '../deleteSelection';

describe('useDeleteSelectionStore', () => {
  beforeEach(() => useDeleteSelectionStore.getState().clear());

  it('starts empty', () => {
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual([]);
  });
  it('toggle adds an id, toggle again removes it', () => {
    useDeleteSelectionStore.getState().toggle('42');
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual(['42']);
    useDeleteSelectionStore.getState().toggle('42');
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual([]);
  });
  it('accumulates multiple ids', () => {
    useDeleteSelectionStore.getState().toggle('1');
    useDeleteSelectionStore.getState().toggle('2');
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual(['1', '2']);
  });
  it('clear empties the selection', () => {
    useDeleteSelectionStore.getState().toggle('1');
    useDeleteSelectionStore.getState().clear();
    expect(useDeleteSelectionStore.getState().selectedIds).toEqual([]);
  });
});
