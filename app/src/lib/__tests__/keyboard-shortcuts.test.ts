/**
 * Keyboard shortcut helper tests (refs #200).
 */

import { describe, it, expect } from 'vitest';
import {
  NAV_SHORTCUTS,
  routeForKey,
  isTypingTarget,
  monitorIdFromBuffer,
} from '../keyboard-shortcuts';

describe('routeForKey', () => {
  it('maps each nav key to its route', () => {
    expect(routeForKey('d')).toBe('/dashboard');
    expect(routeForKey('a')).toBe('/live-activity');
    expect(routeForKey('m')).toBe('/montage');
    expect(routeForKey('e')).toBe('/events');
    expect(routeForKey('v')).toBe('/monitors');
    expect(routeForKey('t')).toBe('/timeline');
  });

  it('is case-insensitive', () => {
    expect(routeForKey('E')).toBe('/events');
  });

  it('returns null for unmapped keys', () => {
    expect(routeForKey('z')).toBeNull();
    expect(routeForKey('1')).toBeNull();
  });

  it('has unique keys and routes', () => {
    const keys = NAV_SHORTCUTS.map((s) => s.key);
    const routes = NAV_SHORTCUTS.map((s) => s.route);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(routes).size).toBe(routes.length);
  });
});

describe('isTypingTarget', () => {
  it('treats inputs, textareas and selects as typing targets', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
  });

  it('treats contenteditable elements as typing targets', () => {
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it('does not treat plain elements or null as typing targets', () => {
    expect(isTypingTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('monitorIdFromBuffer', () => {
  // Real ZM IDs are sparse: gaps from deleted monitors, and the list order is
  // not the IDs (refs #200).
  const ids = ['1', '2', '3', '7', '12'];

  it('returns the monitor ID matching the typed number', () => {
    expect(monitorIdFromBuffer('1', ids)).toBe('1');
    expect(monitorIdFromBuffer('7', ids)).toBe('7');
    expect(monitorIdFromBuffer('12', ids)).toBe('12');
  });

  it('returns null when no monitor has that ID', () => {
    expect(monitorIdFromBuffer('4', ids)).toBeNull();
    expect(monitorIdFromBuffer('9', ids)).toBeNull();
    expect(monitorIdFromBuffer('0', ids)).toBeNull();
  });

  it('normalizes leading zeros to the canonical ID', () => {
    expect(monitorIdFromBuffer('07', ids)).toBe('7');
  });

  it('returns null for non-numeric or empty buffers', () => {
    expect(monitorIdFromBuffer('', ids)).toBeNull();
    expect(monitorIdFromBuffer('1a', ids)).toBeNull();
  });
});
