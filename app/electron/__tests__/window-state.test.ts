/**
 * Electron window-state helper tests (refs #195).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isBoundsVisible, loadWindowState, saveWindowState } = require('../window-state.cjs');

const DISPLAYS = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];

describe('isBoundsVisible', () => {
  it('accepts bounds within a display work area', () => {
    expect(isBoundsVisible({ x: 100, y: 100, width: 800, height: 600 }, DISPLAYS)).toBe(true);
  });

  it('accepts bounds partially overlapping a display', () => {
    expect(isBoundsVisible({ x: -50, y: 0, width: 800, height: 600 }, DISPLAYS)).toBe(true);
  });

  it('rejects bounds fully off every display (disconnected monitor)', () => {
    expect(isBoundsVisible({ x: 5000, y: 0, width: 800, height: 600 }, DISPLAYS)).toBe(false);
  });

  it('rejects bounds with non-finite coordinates', () => {
    expect(isBoundsVisible({ x: NaN, y: 0, width: 800, height: 600 }, DISPLAYS)).toBe(false);
  });
});

describe('loadWindowState / saveWindowState', () => {
  const file = join(tmpdir(), `zmn-window-state-${process.pid}.json`);
  afterEach(() => {
    try { rmSync(file); } catch { /* ignore */ }
  });

  it('round-trips saved bounds', () => {
    const state = { x: 10, y: 20, width: 1024, height: 768, isMaximized: false };
    saveWindowState(file, state);
    expect(loadWindowState(file)).toEqual(state);
  });

  it('returns null for a missing file', () => {
    expect(loadWindowState(join(tmpdir(), 'zmn-does-not-exist.json'))).toBeNull();
  });

  it('returns null for malformed content', () => {
    writeFileSync(file, 'not json');
    expect(loadWindowState(file)).toBeNull();
  });
});
