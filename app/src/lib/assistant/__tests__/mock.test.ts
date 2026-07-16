import { describe, it, expect } from 'vitest';
import { MockProvider } from '../providers/mock';

describe('MockProvider', () => {
  it('returns scripted turns in order then stops', async () => {
    const p = new MockProvider();
    p.setScript([
      { text: undefined, toolCalls: [{ id: 'c1', name: 'count_events', input: {} }] },
      { text: 'You have 3 events.', toolCalls: [] },
    ]);
    const signal = new AbortController().signal;
    const first = await p.chat([{ role: 'user', text: 'how many?' }], [], 'sys', signal);
    expect(first.toolCalls[0].name).toBe('count_events');
    const second = await p.chat([], [], 'sys', signal);
    expect(second.text).toBe('You have 3 events.');
    expect(second.toolCalls).toEqual([]);
  });

  it('rejects when the signal is already aborted', async () => {
    const p = new MockProvider();
    p.setScript([{ text: 'hi', toolCalls: [] }]);
    const ctl = new AbortController();
    ctl.abort();
    await expect(p.chat([], [], 'sys', ctl.signal)).rejects.toThrow();
  });
});
