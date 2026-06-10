import { describe, it, expect } from 'vitest';
import { ZMS_COMMANDS } from '../zm-constants';

describe('ZMS_COMMANDS', () => {
  it('matches the ZoneMinder MsgCommand enum (src/zm_stream.h)', () => {
    expect(ZMS_COMMANDS).toEqual({
      cmdNone: 0,
      cmdPause: 1,
      cmdPlay: 2,
      cmdStop: 3,
      cmdFastFwd: 4,
      cmdSlowFwd: 5,
      cmdSlowRev: 6,
      cmdFastRev: 7,
      cmdZoomIn: 8,
      cmdZoomOut: 9,
      cmdPan: 10,
      cmdScale: 11,
      cmdPrev: 12,
      cmdNext: 13,
      cmdSeek: 14,
      cmdVarPlay: 15,
      cmdGetImage: 16,
      cmdQuit: 17,
      cmdMaxFps: 18,
      cmdQuery: 99,
    });
  });
});
