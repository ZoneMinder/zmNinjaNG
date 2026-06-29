import { describe, it, expect } from 'vitest';
import { ZMS_COMMANDS, zmsCommandName } from '../zm-constants';

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

describe('zmsCommandName', () => {
  it('maps command numbers to readable names', () => {
    expect(zmsCommandName(ZMS_COMMANDS.cmdSeek)).toBe('Seek');
    expect(zmsCommandName(ZMS_COMMANDS.cmdPlay)).toBe('Play');
    expect(zmsCommandName(ZMS_COMMANDS.cmdVarPlay)).toBe('VarPlay');
  });

  it('falls back to Unknown for unmapped values', () => {
    expect(zmsCommandName(123)).toBe('Unknown(123)');
  });
});
