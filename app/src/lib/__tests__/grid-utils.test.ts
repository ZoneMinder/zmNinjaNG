/**
 * Unit tests for grid utility functions
 */

import { describe, it, expect } from 'vitest';
import { calculateGridDimensions, getGridTemplateStyle } from '../grid-utils';

describe('calculateGridDimensions', () => {
  it('returns 0x0 for zero items', () => {
    expect(calculateGridDimensions(0)).toEqual({ cols: 0, rows: 0 });
  });

  it('returns 1x1 for single item', () => {
    expect(calculateGridDimensions(1)).toEqual({ cols: 1, rows: 1 });
  });

  it('returns 2 columns for 2 items', () => {
    expect(calculateGridDimensions(2)).toEqual({ cols: 2, rows: 1 });
  });

  it('returns 2 columns for 3 items', () => {
    expect(calculateGridDimensions(3)).toEqual({ cols: 2, rows: 2 });
  });

  it('returns 2 columns for 4 items', () => {
    expect(calculateGridDimensions(4)).toEqual({ cols: 2, rows: 2 });
  });

  it('returns 3 columns for 5 items', () => {
    expect(calculateGridDimensions(5)).toEqual({ cols: 3, rows: 2 });
  });

  it('returns 3 columns for 6 items', () => {
    expect(calculateGridDimensions(6)).toEqual({ cols: 3, rows: 2 });
  });

  it('returns 3 columns for 7 items', () => {
    expect(calculateGridDimensions(7)).toEqual({ cols: 3, rows: 3 });
  });

  it('returns 3 columns for 8 items', () => {
    expect(calculateGridDimensions(8)).toEqual({ cols: 3, rows: 3 });
  });

  it('returns 3 columns for 9 items', () => {
    expect(calculateGridDimensions(9)).toEqual({ cols: 3, rows: 3 });
  });

  it('returns 3 columns for 10 items', () => {
    expect(calculateGridDimensions(10)).toEqual({ cols: 3, rows: 4 });
  });

  it('calculates rows correctly for larger numbers', () => {
    expect(calculateGridDimensions(12)).toEqual({ cols: 3, rows: 4 });
    expect(calculateGridDimensions(15)).toEqual({ cols: 3, rows: 5 });
    expect(calculateGridDimensions(20)).toEqual({ cols: 3, rows: 7 });
  });

  it('handles non-divisible numbers correctly', () => {
    // 11 items with 3 cols = 4 rows (ceil(11/3) = 4)
    expect(calculateGridDimensions(11)).toEqual({ cols: 3, rows: 4 });

    // 13 items with 3 cols = 5 rows (ceil(13/3) = 5)
    expect(calculateGridDimensions(13)).toEqual({ cols: 3, rows: 5 });
  });

  it('switches from 2 to 3 columns at 5 items', () => {
    expect(calculateGridDimensions(4)).toEqual({ cols: 2, rows: 2 });
    expect(calculateGridDimensions(5)).toEqual({ cols: 3, rows: 2 });
  });

  it('handles very large numbers', () => {
    const result = calculateGridDimensions(100);
    expect(result.cols).toBe(3);
    expect(result.rows).toBe(Math.ceil(100 / 3));
  });
});

describe('getGridTemplateStyle', () => {
  it('generates CSS for 1x1 grid', () => {
    const result = getGridTemplateStyle(1, 1);

    expect(result).toEqual({
      gridTemplateColumns: 'repeat(1, 1fr)',
      gridTemplateRows: 'repeat(1, 1fr)',
    });
  });

  it('generates CSS for 2x2 grid', () => {
    const result = getGridTemplateStyle(2, 2);

    expect(result).toEqual({
      gridTemplateColumns: 'repeat(2, 1fr)',
      gridTemplateRows: 'repeat(2, 1fr)',
    });
  });

  it('generates CSS for 3x3 grid', () => {
    const result = getGridTemplateStyle(3, 3);

    expect(result).toEqual({
      gridTemplateColumns: 'repeat(3, 1fr)',
      gridTemplateRows: 'repeat(3, 1fr)',
    });
  });

  it('handles non-square grids', () => {
    const result = getGridTemplateStyle(3, 5);

    expect(result).toEqual({
      gridTemplateColumns: 'repeat(3, 1fr)',
      gridTemplateRows: 'repeat(5, 1fr)',
    });
  });

  it('handles 0 columns and rows', () => {
    const result = getGridTemplateStyle(0, 0);

    expect(result).toEqual({
      gridTemplateColumns: 'repeat(0, 1fr)',
      gridTemplateRows: 'repeat(0, 1fr)',
    });
  });

  it('handles single column grid', () => {
    const result = getGridTemplateStyle(1, 5);

    expect(result).toEqual({
      gridTemplateColumns: 'repeat(1, 1fr)',
      gridTemplateRows: 'repeat(5, 1fr)',
    });
  });

  it('handles single row grid', () => {
    const result = getGridTemplateStyle(5, 1);

    expect(result).toEqual({
      gridTemplateColumns: 'repeat(5, 1fr)',
      gridTemplateRows: 'repeat(1, 1fr)',
    });
  });

  it('uses 1fr for equal spacing', () => {
    const result = getGridTemplateStyle(4, 3);

    expect(result.gridTemplateColumns).toContain('1fr');
    expect(result.gridTemplateRows).toContain('1fr');
  });

  it('returns valid React.CSSProperties object', () => {
    const result = getGridTemplateStyle(3, 2);

    expect(typeof result).toBe('object');
    expect(result).toHaveProperty('gridTemplateColumns');
    expect(result).toHaveProperty('gridTemplateRows');
  });

  it('handles large grid dimensions', () => {
    const result = getGridTemplateStyle(10, 20);

    expect(result).toEqual({
      gridTemplateColumns: 'repeat(10, 1fr)',
      gridTemplateRows: 'repeat(20, 1fr)',
    });
  });
});

describe('Integration: calculateGridDimensions + getGridTemplateStyle', () => {
  it('works together for 4 items', () => {
    const dimensions = calculateGridDimensions(4);
    const style = getGridTemplateStyle(dimensions.cols, dimensions.rows);

    expect(style).toEqual({
      gridTemplateColumns: 'repeat(2, 1fr)',
      gridTemplateRows: 'repeat(2, 1fr)',
    });
  });

  it('works together for 9 items', () => {
    const dimensions = calculateGridDimensions(9);
    const style = getGridTemplateStyle(dimensions.cols, dimensions.rows);

    expect(style).toEqual({
      gridTemplateColumns: 'repeat(3, 1fr)',
      gridTemplateRows: 'repeat(3, 1fr)',
    });
  });

  it('works together for 10 items', () => {
    const dimensions = calculateGridDimensions(10);
    const style = getGridTemplateStyle(dimensions.cols, dimensions.rows);

    expect(style).toEqual({
      gridTemplateColumns: 'repeat(3, 1fr)',
      gridTemplateRows: 'repeat(4, 1fr)',
    });
  });

  it('works together for 0 items', () => {
    const dimensions = calculateGridDimensions(0);
    const style = getGridTemplateStyle(dimensions.cols, dimensions.rows);

    expect(style).toEqual({
      gridTemplateColumns: 'repeat(0, 1fr)',
      gridTemplateRows: 'repeat(0, 1fr)',
    });
  });
});
