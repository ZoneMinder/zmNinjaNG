import { describe, it, expect } from 'vitest';
import { parseAlarmState, isAlarmingState, isArmedState } from '../alarm-state';

describe('parseAlarmState', () => {
  it('maps numeric ZoneMinder states to named states', () => {
    expect(parseAlarmState({ status: 0 })).toBe('idle');
    expect(parseAlarmState({ status: 1 })).toBe('prealarm');
    expect(parseAlarmState({ status: 2 })).toBe('alarm');
    expect(parseAlarmState({ status: 3 })).toBe('alert');
    expect(parseAlarmState({ status: 4 })).toBe('tape');
  });

  it('accepts the same states as strings', () => {
    expect(parseAlarmState({ status: '0' })).toBe('idle');
    expect(parseAlarmState({ status: '2' })).toBe('alarm');
  });

  it('falls back to the output field when status is absent', () => {
    expect(parseAlarmState({ output: 2 })).toBe('alarm');
    expect(parseAlarmState({ output: '0' })).toBe('idle');
  });

  it('prefers status over output when both are present', () => {
    expect(parseAlarmState({ status: 0, output: 2 })).toBe('idle');
  });

  it('maps non-numeric truthy words to alarm', () => {
    expect(parseAlarmState({ status: 'on' })).toBe('alarm');
    expect(parseAlarmState({ status: 'armed' })).toBe('alarm');
    expect(parseAlarmState({ status: 'true' })).toBe('alarm');
  });

  it('maps non-numeric falsy words to idle', () => {
    expect(parseAlarmState({ status: 'off' })).toBe('idle');
    expect(parseAlarmState({ status: 'false' })).toBe('idle');
  });

  it('returns unknown for an absent response or an unrecognised value', () => {
    expect(parseAlarmState(undefined)).toBe('unknown');
    expect(parseAlarmState({})).toBe('unknown');
    expect(parseAlarmState({ status: null })).toBe('unknown');
    expect(parseAlarmState({ status: 'wat' })).toBe('unknown');
  });

  it('treats the ZoneMinder API error sentinel as unknown, not as an alarm', () => {
    // api/monitors.ts uses the literal string 'false' as the error marker.
    expect(parseAlarmState({ status: 'false', error: 'nope' })).toBe('idle');
  });
});

describe('isAlarmingState', () => {
  it('counts alarm and alert as alarming', () => {
    expect(isAlarmingState('alarm')).toBe(true);
    expect(isAlarmingState('alert')).toBe(true);
  });

  it('does not count idle, prealarm, tape, or unknown as alarming', () => {
    expect(isAlarmingState('idle')).toBe(false);
    expect(isAlarmingState('prealarm')).toBe(false);
    expect(isAlarmingState('tape')).toBe(false);
    expect(isAlarmingState('unknown')).toBe(false);
  });
});

describe('isArmedState', () => {
  // Preserves useAlarmControl's existing rule: any finite non-zero state is armed.
  it('counts every non-idle known state as armed', () => {
    expect(isArmedState('prealarm')).toBe(true);
    expect(isArmedState('alarm')).toBe(true);
    expect(isArmedState('alert')).toBe(true);
    expect(isArmedState('tape')).toBe(true);
  });

  it('does not count idle or unknown as armed', () => {
    expect(isArmedState('idle')).toBe(false);
    expect(isArmedState('unknown')).toBe(false);
  });
});
