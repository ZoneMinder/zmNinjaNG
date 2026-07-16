import { describe, it, expect, beforeEach } from 'vitest';
import { useCommandPaletteStore } from '../commandPalette';

describe('useCommandPaletteStore', () => {
  beforeEach(() => useCommandPaletteStore.setState({ open: false, mode: 'command' }));

  it('defaults to closed', () => {
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });

  it('defaults to command mode', () => {
    expect(useCommandPaletteStore.getState().mode).toBe('command');
  });

  it('setOpen sets the open flag', () => {
    useCommandPaletteStore.getState().setOpen(true);
    expect(useCommandPaletteStore.getState().open).toBe(true);
  });

  it('toggle flips the open flag', () => {
    useCommandPaletteStore.getState().toggle();
    expect(useCommandPaletteStore.getState().open).toBe(true);
    useCommandPaletteStore.getState().toggle();
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });

  it('setMode sets the mode', () => {
    useCommandPaletteStore.getState().setMode('ask');
    expect(useCommandPaletteStore.getState().mode).toBe('ask');
  });

  it('openAsk opens the palette in ask mode', () => {
    useCommandPaletteStore.getState().openAsk();
    expect(useCommandPaletteStore.getState().open).toBe(true);
    expect(useCommandPaletteStore.getState().mode).toBe('ask');
  });

  it('setOpen(false) resets mode back to command', () => {
    useCommandPaletteStore.getState().openAsk();
    useCommandPaletteStore.getState().setOpen(false);
    expect(useCommandPaletteStore.getState().mode).toBe('command');
  });

  it('setOpen(true) preserves the current mode', () => {
    useCommandPaletteStore.getState().setMode('ask');
    useCommandPaletteStore.getState().setOpen(true);
    expect(useCommandPaletteStore.getState().mode).toBe('ask');
  });
});
