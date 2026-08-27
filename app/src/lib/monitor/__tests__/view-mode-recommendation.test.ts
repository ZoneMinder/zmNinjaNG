import { describe, it, expect } from 'vitest';
import { recommendViewMode } from '../view-mode-recommendation';

describe('recommendViewMode', () => {
  it('recommends streaming for a small server', () => {
    expect(recommendViewMode(5, undefined)).toEqual({ mode: 'streaming', reason: 'few-monitors' });
  });

  it('recommends snapshot one past the limit, leaving a connection for API calls', () => {
    expect(recommendViewMode(6, undefined)).toEqual({ mode: 'snapshot', reason: 'many-monitors' });
  });

  it('recommends streaming at any count when multi-port is configured', () => {
    expect(recommendViewMode(40, 30000)).toEqual({ mode: 'streaming', reason: 'multi-port' });
  });

  it('recommends snapshot for a big server without multi-port', () => {
    expect(recommendViewMode(20, undefined)).toEqual({ mode: 'snapshot', reason: 'many-monitors' });
  });

  it('treats an unknown monitor count as a big server', () => {
    expect(recommendViewMode(null, undefined)).toEqual({ mode: 'snapshot', reason: 'many-monitors' });
    expect(recommendViewMode(null, 30000)).toEqual({ mode: 'streaming', reason: 'multi-port' });
  });
});
