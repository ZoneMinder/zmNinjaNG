import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import { BANDWIDTH_SETTINGS } from '../../lib/zmninja-ng-constants';

describe('recent-events settings defaults', () => {
  it('defaults the count to 5', () => {
    expect(DEFAULT_SETTINGS.monitorDetailRecentEventsCount).toBe(5);
  });
  it('defaults the hidden set to empty', () => {
    expect(DEFAULT_SETTINGS.monitorDetailRecentEventsHidden).toEqual([]);
  });
  it('sets normal/low refresh intervals in ms', () => {
    expect(BANDWIDTH_SETTINGS.normal.monitorRecentEventsInterval).toBe(30000);
    expect(BANDWIDTH_SETTINGS.low.monitorRecentEventsInterval).toBe(60000);
  });
});
