import { describe, it, expect, vi } from 'vitest';
import {
  registerActiveStream,
  unregisterActiveStream,
  quitAllActiveStreams,
} from '../active-streams';

describe('active-streams registry', () => {
  it('runs all registered teardowns and awaits them', async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    registerActiveStream('a', a);
    registerActiveStream('b', b);

    await quitAllActiveStreams();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    unregisterActiveStream('a');
    unregisterActiveStream('b');
  });

  it('does not reject when a teardown throws', async () => {
    const bad = vi.fn().mockRejectedValue(new Error('boom'));
    registerActiveStream('bad', bad);

    await expect(quitAllActiveStreams()).resolves.toBeUndefined();

    unregisterActiveStream('bad');
  });

  it('does not run a teardown after it is unregistered', async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    registerActiveStream('a', a);
    unregisterActiveStream('a');

    await quitAllActiveStreams();

    expect(a).not.toHaveBeenCalled();
  });
});
