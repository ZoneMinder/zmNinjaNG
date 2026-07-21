/**
 * resolveMonitorRef (refs #246): turns whatever the model called a monitor
 * into a real id, or an error naming the monitors that exist.
 */
import { describe, it, expect } from 'vitest';
import { resolveMonitorRef } from '../monitor-ref';
import type { MonitorData } from '../../../api/types';

const monitor = (Id: string, Name: string) => ({ Monitor: { Id, Name } }) as MonitorData;
const monitors = [monitor('1', 'Front Door'), monitor('4', 'Back Garden')];

describe('resolveMonitorRef', () => {
  it('passes an existing id through', () => {
    expect(resolveMonitorRef('4', monitors)).toEqual({ id: '4' });
  });

  it('resolves an exact name', () => {
    expect(resolveMonitorRef('Front Door', monitors)).toEqual({ id: '1' });
  });

  it.each([
    ['front door', 'lowercase'],
    ['FRONT DOOR', 'uppercase'],
    ['FrontDoor', 'spaces removed, as the model actually sent it'],
    ['front-door', 'hyphenated'],
    ['  Front Door  ', 'padded'],
    ['front_door', 'underscored'],
  ])('resolves %s (%s)', (ref) => {
    expect(resolveMonitorRef(ref, monitors)).toEqual({ id: '1' });
  });

  it('errors for a name that matches nothing, naming what does exist', () => {
    const result = resolveMonitorRef('Garage', monitors);
    expect(result).toHaveProperty('error');
    const { error } = result as { error: string };
    // The model needs the real options to retry; an error it cannot act on
    // just becomes another wrong answer.
    expect(error).toContain('Front Door');
    expect(error).toContain('Back Garden');
    expect(error).toContain('id 1');
  });

  // The id would otherwise reach ZoneMinder, match nothing, and come back as
  // an empty result set that reads exactly like "there were no events".
  it('errors for a numeric id that matches no monitor', () => {
    expect(resolveMonitorRef('999', monitors)).toHaveProperty('error');
  });

  it('errors rather than guessing when two monitors share a name', () => {
    const dupes = [monitor('1', 'Side'), monitor('2', 'Side')];
    const result = resolveMonitorRef('side', dupes);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('1, 2');
  });

  it('prefers an id match over a name match when a name looks like an id', () => {
    const odd = [monitor('1', '2'), monitor('2', 'Patio')];
    // "2" is both monitor 2's id and monitor 1's name. The id wins: the schema
    // asks for an id, so that reading comes first.
    expect(resolveMonitorRef('2', odd)).toEqual({ id: '2' });
  });

  it('errors on an empty ref', () => {
    expect(resolveMonitorRef('   ', monitors)).toHaveProperty('error');
  });

  // ASCII-only normalization turned every non-Latin name into '', so two such
  // monitors collided as false "duplicates" and any non-ASCII ref matched both.
  it('resolves non-Latin names individually', () => {
    const cyrillic = [monitor('7', 'Кухня'), monitor('8', 'Двор')];
    expect(resolveMonitorRef('кухня', cyrillic)).toEqual({ id: '7' });
    expect(resolveMonitorRef('двор', cyrillic)).toEqual({ id: '8' });
  });
});
