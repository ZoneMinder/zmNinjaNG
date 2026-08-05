import { describe, it, expect, beforeEach } from 'vitest';
import { useDeleteSelectionStore, eventSelectionKey, parseEventSelectionKey } from '../deleteSelection';
import { asProfileId } from '../../api/types';

const P1 = asProfileId('p1');
const P2 = asProfileId('p2');

describe('useDeleteSelectionStore', () => {
  beforeEach(() => useDeleteSelectionStore.getState().clear());

  it('starts empty', () => {
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
  });
  it('toggle adds a key, toggle again removes it', () => {
    useDeleteSelectionStore.getState().toggle('42');
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual(['42']);
    useDeleteSelectionStore.getState().toggle('42');
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
  });
  it('accumulates multiple keys', () => {
    useDeleteSelectionStore.getState().toggle('1');
    useDeleteSelectionStore.getState().toggle('2');
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual(['1', '2']);
  });
  it('clear empties the selection', () => {
    useDeleteSelectionStore.getState().toggle('1');
    useDeleteSelectionStore.getState().clear();
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([]);
  });
  it('remove drops only the given keys', () => {
    useDeleteSelectionStore.getState().toggle(eventSelectionKey(P1, '1'));
    useDeleteSelectionStore.getState().toggle(eventSelectionKey(P2, '2'));
    useDeleteSelectionStore.getState().remove([eventSelectionKey(P1, '1')]);
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([eventSelectionKey(P2, '2')]);
  });

  it('the same raw event id on two profiles selects independently', () => {
    useDeleteSelectionStore.getState().toggle(eventSelectionKey(P1, '1234'));
    expect(useDeleteSelectionStore.getState().selectedKeys).toEqual([eventSelectionKey(P1, '1234')]);
    expect(useDeleteSelectionStore.getState().selectedKeys).not.toContain(eventSelectionKey(P2, '1234'));
  });
});

describe('eventSelectionKey', () => {
  it('round-trips a profile-scoped key', () => {
    expect(parseEventSelectionKey(eventSelectionKey(P1, '1234'))).toEqual({ profileId: P1, eventId: '1234' });
  });
  it('keeps the two profiles distinct for one raw event id', () => {
    expect(eventSelectionKey(P1, '1234')).not.toBe(eventSelectionKey(P2, '1234'));
  });
  it('falls back to the bare event id when no profile is known', () => {
    expect(eventSelectionKey(undefined, '1234')).toBe('1234');
    expect(parseEventSelectionKey('1234')).toEqual({ eventId: '1234' });
  });
});
