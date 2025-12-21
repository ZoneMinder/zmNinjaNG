import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMonitorStore } from '../monitors';

describe('Monitor Store', () => {
  beforeEach(() => {
    useMonitorStore.setState({ connKeys: {} });
    vi.spyOn(Math, 'random').mockReturnValue(0.12345);
  });

  it('returns existing connection key', () => {
    useMonitorStore.setState({ connKeys: { '1': 999 } });

    const key = useMonitorStore.getState().getConnKey('1');

    expect(key).toBe(999);
  });

  it('creates a new connection key when missing', () => {
    const key = useMonitorStore.getState().getConnKey('2');

    expect(key).toBe(12345);
    expect(useMonitorStore.getState().connKeys['2']).toBe(12345);
  });

  it('regenerates connection key', () => {
    const key = useMonitorStore.getState().regenerateConnKey('3');

    expect(key).toBe(12345);
    expect(useMonitorStore.getState().connKeys['3']).toBe(12345);
  });
});
