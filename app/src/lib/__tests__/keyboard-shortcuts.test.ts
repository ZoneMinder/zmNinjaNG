/**
 * Keyboard shortcut helper tests (refs #200).
 */

import { describe, it, expect } from 'vitest';
import {
  NAV_SHORTCUTS,
  routeForKey,
  isTypingTarget,
  monitorIndexFromBuffer,
} from '../keyboard-shortcuts';

describe('routeForKey', () => {
  it('maps each nav key to its route', () => {
    expect(routeForKey('d')).toBe('/dashboard');
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

describe('monitorIndexFromBuffer', () => {
  it('converts a 1-based number to a 0-based index', () => {
    expect(monitorIndexFromBuffer('1', 10)).toBe(0);
    expect(monitorIndexFromBuffer('10', 10)).toBe(9);
    expect(monitorIndexFromBuffer('12', 20)).toBe(11);
  });

  it('returns null when out of range', () => {
    expect(monitorIndexFromBuffer('0', 10)).toBeNull();
    expect(monitorIndexFromBuffer('11', 10)).toBeNull();
  });

  it('returns null for non-numeric buffers', () => {
    expect(monitorIndexFromBuffer('', 10)).toBeNull();
    expect(monitorIndexFromBuffer('1a', 10)).toBeNull();
  });
});
