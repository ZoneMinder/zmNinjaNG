/**
 * All-mode reduced stream tuning: what a montage tile asks ZM for when the
 * user trades picture quality for load across servers.
 */
import { describe, expect, it } from 'vitest';
import { tunedStreamOptions } from '../stream-tuning';
import { MONTAGE_GRID } from '../../zmninja-ng-constants';

describe('tunedStreamOptions', () => {
  it('hands back the profile values untouched when tuning is off', () => {
    expect(tunedStreamOptions({ maxfps: 10, scale: 50 }, false)).toEqual({
      maxfps: 10,
      scale: 50,
    });
  });

  it('cuts frame rate and scale to the reduced ceiling', () => {
    expect(tunedStreamOptions({ maxfps: 10, scale: 50 }, true)).toEqual({
      maxfps: MONTAGE_GRID.reducedMaxFps,
      scale: MONTAGE_GRID.reducedScale,
    });
  });

  it('leaves a profile that already asks for less where it is', () => {
    // "Reduce" must never turn into "raise": a server the user has already
    // throttled to 2fps keeps streaming at 2fps.
    expect(tunedStreamOptions({ maxfps: 2, scale: 10 }, true)).toEqual({
      maxfps: 2,
      scale: 10,
    });
  });

  it('applies the ceiling when the profile asks for no limit at all', () => {
    // An unset value means "whatever ZM sends", which is the most expensive
    // stream of all, so the ceiling applies rather than passing it through.
    expect(tunedStreamOptions({}, true)).toEqual({
      maxfps: MONTAGE_GRID.reducedMaxFps,
      scale: MONTAGE_GRID.reducedScale,
    });
  });
});
