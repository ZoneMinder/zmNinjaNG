import { describe, it, expect } from 'vitest';
import { filterCommandItems, type CommandItem } from '../command-palette';

const items: CommandItem[] = [
  { kind: 'page', id: 'p-montage', label: 'Montage', route: '/montage', hintKey: 'm' },
  { kind: 'page', id: 'p-monitors', label: 'Monitors', route: '/monitors', hintKey: 'v' },
  { kind: 'group', id: 'g-1', label: 'Front Cameras', groupId: '1' },
  { kind: 'monitor', id: 'm-1', label: 'Front Door', monitorId: '1' },
  { kind: 'monitor', id: 'm-12', label: 'Driveway', monitorId: '12' },
];

describe('filterCommandItems', () => {
  it('returns pages and groups (no monitors) for an empty query', () => {
    const result = filterCommandItems(items, '');
    expect(result.map((i) => i.kind)).toEqual(['page', 'page', 'group']);
  });

  it('matches monitor by name substring (case-insensitive)', () => {
    const result = filterCommandItems(items, 'front');
    // Page/group order before monitors; both "Front Cameras" and "Front Door" match.
    expect(result.map((i) => i.id)).toEqual(['g-1', 'm-1']);
  });

  it('matches a monitor by its exact ID', () => {
    const result = filterCommandItems(items, '12');
    expect(result.map((i) => i.id)).toEqual(['m-12']);
  });

  it('groups results pages, then groups, then monitors', () => {
    const result = filterCommandItems(items, 'mon'); // "Montage","Monitors" pages
    expect(result.map((i) => i.kind)).toEqual(['page', 'page']);
  });

  it('ranks prefix matches above mid-string within a kind', () => {
    const list: CommandItem[] = [
      { kind: 'monitor', id: 'a', label: 'Back Door', monitorId: '3' },
      { kind: 'monitor', id: 'b', label: 'Door Camera', monitorId: '4' },
    ];
    // "door": "Door Camera" is a prefix match, ranks first.
    expect(filterCommandItems(list, 'door').map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('returns nothing for a query that matches no item', () => {
    expect(filterCommandItems(items, 'zzz')).toEqual([]);
  });
});
