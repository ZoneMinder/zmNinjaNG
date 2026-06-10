/**
 * Tests for tv-dpad-nav install/uninstall lifecycle.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { installDpadNavigator, uninstallDpadNavigator } from '../tv-dpad-nav';

function pressEnter(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }));
}

describe('tv-dpad-nav', () => {
  afterEach(() => {
    uninstallDpadNavigator();
    document.body.innerHTML = '';
  });

  it('handles Enter on the focused element after install', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    button.focus();

    installDpadNavigator();
    pressEnter();

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('stops handling keydown after uninstall', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    button.focus();

    installDpadNavigator();
    uninstallDpadNavigator();
    pressEnter();

    expect(onClick).not.toHaveBeenCalled();
  });

  it('can be reinstalled after uninstall', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    button.focus();

    installDpadNavigator();
    uninstallDpadNavigator();
    installDpadNavigator();
    pressEnter();

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('install is idempotent: a second install does not double-handle keys', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    button.focus();

    installDpadNavigator();
    installDpadNavigator();
    pressEnter();

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('uninstall without a prior install is a no-op', () => {
    expect(() => uninstallDpadNavigator()).not.toThrow();
  });
});
