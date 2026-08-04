/**
 * All-mode reduced stream tuning
 *
 * All Servers mode can ask every montage tile for a cheaper stream
 * (`allModeStreamTuning`, refs #337). Watching four servers at once is four
 * servers' worth of encoding and one client's worth of decoding, so the knob
 * trades picture quality for a montage that keeps up.
 *
 * Only the MJPEG path is affected: `maxfps` and `scale` are ZMS query
 * parameters, and a go2rtc/WebRTC tile is served by go2rtc from an existing
 * RTSP stream, which neither parameter reaches. Those tiles stream unchanged;
 * a user who needs the saving there sets the montage to MJPEG.
 */

import { MONTAGE_GRID } from '../zmninja-ng-constants';

export interface TunableStreamOptions {
  maxfps?: number;
  scale?: number;
}

/** A ceiling, never a floor. An unset value means "whatever ZM sends", which
 *  is the most expensive stream there is, so the ceiling applies to it too. */
const atMost = (own: number | undefined, ceiling: number): number =>
  own && own > 0 ? Math.min(own, ceiling) : ceiling;

/**
 * What this tile should ask ZM for.
 *
 * @param own - The owning profile's own stream preferences.
 * @param reduce - Whether the view has asked for reduced tuning.
 * @returns `own` untouched when not reducing, otherwise its values held down
 *   to the reduced ceilings.
 */
export function tunedStreamOptions(
  own: TunableStreamOptions,
  reduce: boolean,
): TunableStreamOptions {
  if (!reduce) return own;
  return {
    maxfps: atMost(own.maxfps, MONTAGE_GRID.reducedMaxFps),
    scale: atMost(own.scale, MONTAGE_GRID.reducedScale),
  };
}
