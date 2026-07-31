import { describe, it, expect } from 'vitest';
import { getLiveActivityRowSpan } from '../live-activity-layout';
import { MONTAGE_GRID } from '../../zmninja-ng-constants';

/**
 * Row units are one pixel, so a span is the tile's height in pixels: the
 * column width times the camera's height/width ratio, plus the card header.
 */
const shape = (Width: string, Height: string, Orientation: string | null = null) => ({
  Width,
  Height,
  Orientation,
});

const HEADER = MONTAGE_GRID.cardHeaderHeightPx;

describe('getLiveActivityRowSpan', () => {
  it('sizes a tile from its own aspect ratio plus the card header', () => {
    // 800px over two columns is a 400px column.
    expect(getLiveActivityRowSpan(shape('1920', '1080'), 800, 2)).toBe(Math.ceil(400 * (9 / 16) + HEADER));
    expect(getLiveActivityRowSpan(shape('640', '480'), 800, 2)).toBe(Math.ceil(400 * (3 / 4) + HEADER));
  });

  it('gives a 4:3 camera a taller span than a 16:9 one at the same width', () => {
    const wide = getLiveActivityRowSpan(shape('1920', '1080'), 800, 2);
    const boxy = getLiveActivityRowSpan(shape('640', '480'), 800, 2);
    expect(boxy).toBeGreaterThan(wide);
    expect(boxy - wide).toBe(Math.ceil(400 * (3 / 4)) - Math.ceil(400 * (9 / 16)));
  });

  it('gives a portrait camera a taller span than a landscape one at the same width', () => {
    const landscape = getLiveActivityRowSpan(shape('1920', '1080'), 800, 2);
    const portrait = getLiveActivityRowSpan(shape('1080', '1920'), 800, 2);
    expect(portrait).toBe(Math.ceil(400 * (16 / 9) + HEADER));
    expect(portrait).toBeGreaterThan(landscape);
  });

  it('follows the rotation ZoneMinder reports rather than the raw dimensions', () => {
    const upright = getLiveActivityRowSpan(shape('1920', '1080'), 800, 2);
    const rotated = getLiveActivityRowSpan(shape('1920', '1080', 'ROTATE_90'), 800, 2);
    expect(rotated).toBe(Math.ceil(400 * (16 / 9) + HEADER));
    expect(rotated).toBeGreaterThan(upright);
  });

  it('falls back to a positive span when the reported dimensions are unusable', () => {
    const fallback = getLiveActivityRowSpan(shape('1920', '1080'), 800, 2);
    for (const unusable of [shape('0', '0'), shape('', ''), shape('abc', '1080')]) {
      expect(getLiveActivityRowSpan(unusable, 800, 2)).toBe(fallback);
    }
  });

  it('never returns a span a tile could collapse into', () => {
    // Before the grid has been measured, and if a column count ever arrives
    // as zero or a fraction.
    expect(getLiveActivityRowSpan(shape('1920', '1080'), 0, 2)).toBe(HEADER);
    expect(getLiveActivityRowSpan(shape('1920', '1080'), 800, 0)).toBe(Math.ceil(800 * (9 / 16) + HEADER));
    expect(getLiveActivityRowSpan(shape('1920', '1080'), Number.NaN, 2)).toBe(HEADER);
  });

  it('shrinks a tile as the grid gets more columns', () => {
    const twoUp = getLiveActivityRowSpan(shape('1920', '1080'), 1200, 2);
    const fourUp = getLiveActivityRowSpan(shape('1920', '1080'), 1200, 4);
    expect(twoUp).toBe(Math.ceil(600 * (9 / 16) + HEADER));
    expect(fourUp).toBe(Math.ceil(300 * (9 / 16) + HEADER));
  });
});
