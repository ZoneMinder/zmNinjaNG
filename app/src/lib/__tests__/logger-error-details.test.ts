/**
 * ERROR-level component logs must be redacted like every other level
 * (refs #307).
 *
 * The ERROR path used to serialize its details object with JSON.stringify
 * before handing it to the sanitizer. The sanitizer redacts by key, and a
 * flattened object has no keys left to match, so every secret in an ERROR
 * detail reached the console, the in-memory store, the log file, and the
 * exported log verbatim. There are ~130 such call sites.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { logger, log, LogLevel } from '../logger';
import { useLogStore } from '../../stores/logs';
import { setLogRedactionGate } from '../log-sanitizer';

beforeEach(() => {
  useLogStore.setState({ logs: [] });
  logger.setLevel(LogLevel.DEBUG);
  setLogRedactionGate({ isRedactionDisabled: () => false });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const stored = () => JSON.stringify(useLogStore.getState().logs);

describe('ERROR-level component logs', () => {
  it('redacts a password in the details object', () => {
    log.monitor('save failed', LogLevel.ERROR, { password: 'S3cret' });
    expect(stored()).not.toContain('S3cret');
  });

  it('redacts a camera credential carried in a details field', () => {
    log.monitor('capture failed', LogLevel.ERROR, {
      Path: 'rtsp://admin:S3cret@cam.lan:554/h264',
    });
    expect(stored()).not.toContain('S3cret');
  });

  it('keeps the non-sensitive details readable', () => {
    log.monitor('save failed', LogLevel.ERROR, { monitorId: '7', password: 'S3cret' });
    expect(stored()).toContain('7');
  });

  it('redacts the same details at WARN, which never stringified (control)', () => {
    log.monitor('save failed', LogLevel.WARN, { password: 'S3cret' });
    expect(stored()).not.toContain('S3cret');
  });

  it('redacts a credential in the stack trace written to the console', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.error('request failed', { component: 'HTTP' }, new Error('connect rtsp://admin:S3cret@cam/live'));
    const printed = spy.mock.calls.flat().map(String).join('\n');
    expect(printed).not.toContain('S3cret');
  });
});
