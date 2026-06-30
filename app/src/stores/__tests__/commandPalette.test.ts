import { describe, it, expect, beforeEach } from 'vitest';
import { useCommandPaletteStore } from '../commandPalette';

describe('useCommandPaletteStore', () => {
  beforeEach(() => useCommandPaletteStore.setState({ open: false }));

  it('defaults to closed', () => {
    expect(useCommandPaletteStore.getState().open).toBe(false);
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
});
