import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installGlobalErrorHandlers, uninstallGlobalErrorHandlers } from '../global-error-handlers';
import { logger, LogLevel } from '../logger';
import { useLogStore } from '../../stores/logs';
import { __resetLogFileForTests } from '../log-file';
import { LOGGING } from '../zmninja-ng-constants';

// jsdom does not implement PromiseRejectionEvent, so synthesize a plain
// Event carrying a `reason` property. The listener only reads `reason`.
function dispatchRejection(reason: unknown): Event {
  const event = new Event('unhandledrejection', { cancelable: true });
  (event as unknown as { reason: unknown }).reason = reason;
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  useLogStore.setState({ logs: [] });
  logger.setLevel(LogLevel.DEBUG);
  __resetLogFileForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  uninstallGlobalErrorHandlers();
  vi.restoreAllMocks();
});

describe('installGlobalErrorHandlers', () => {
  it('logs uncaught window errors with message, source, and stack', () => {
    installGlobalErrorHandlers();
    const error = new Error('boom');
    const event = new ErrorEvent('error', {
      message: 'Uncaught Error: boom',
      filename: 'app.js',
      lineno: 12,
      colno: 5,
      error,
      cancelable: true,
    });
    window.dispatchEvent(event);

    const logs = useLogStore.getState().logs;
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('ERROR');
    expect(logs[0].context).toMatchObject({ component: 'App' });
    expect(logs[0].message).toContain('Uncaught window error');
    // Details reach the sink as the object they were logged as, not
    // pre-serialized: a flattened string has no keys left for the redaction
    // rules to match (refs #307).
    const details = JSON.stringify(logs[0].args?.[0]);
    expect(details).toContain('Uncaught Error: boom');
    expect(details).toContain('app.js:12:5');
    expect(details).toContain('boom');
    // preventDefault must not be called: console behavior stays default.
    expect(event.defaultPrevented).toBe(false);
  });

  it('logs unhandled promise rejections with an Error reason', () => {
    installGlobalErrorHandlers();
    const event = dispatchRejection(new Error('async failure'));

    const logs = useLogStore.getState().logs;
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('ERROR');
    expect(logs[0].message).toContain('Unhandled promise rejection');
    const details = JSON.stringify(logs[0].args?.[0]);
    expect(details).toContain('async failure');
    expect(event.defaultPrevented).toBe(false);
  });

  it('logs non-Error rejection reasons', () => {
    installGlobalErrorHandlers();
    dispatchRejection({ code: 42 });
    dispatchRejection('plain string reason');
    dispatchRejection(undefined);

    // The log store prepends, so logs[0] is the most recent entry.
    const logs = useLogStore.getState().logs;
    expect(logs).toHaveLength(3);
    expect(JSON.stringify(logs[2].args?.[0])).toContain('42');
    expect(JSON.stringify(logs[1].args?.[0])).toContain('plain string reason');
    expect(JSON.stringify(logs[0].args?.[0])).toContain('undefined');
  });

  it('truncates long stacks', () => {
    installGlobalErrorHandlers();
    const error = new Error('deep');
    error.stack = 'x'.repeat(LOGGING.maxStackLength + 500);
    dispatchRejection(error);

    const logs = useLogStore.getState().logs;
    expect(logs).toHaveLength(1);
    const details = JSON.stringify(logs[0].args?.[0]);
    expect(details).toContain('truncated');
    // The full untruncated stack must not be present.
    expect(details).not.toContain('x'.repeat(LOGGING.maxStackLength + 500));
  });

  it('double install registers listeners once', () => {
    installGlobalErrorHandlers();
    installGlobalErrorHandlers();
    dispatchRejection(new Error('once'));

    expect(useLogStore.getState().logs).toHaveLength(1);
  });

  it('uninstall removes listeners', () => {
    installGlobalErrorHandlers();
    uninstallGlobalErrorHandlers();
    dispatchRejection(new Error('after uninstall'));
    window.dispatchEvent(new ErrorEvent('error', { message: 'after uninstall' }));

    expect(useLogStore.getState().logs).toHaveLength(0);
  });
});
