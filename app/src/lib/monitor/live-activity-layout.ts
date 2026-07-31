/**
 * Row-span packing for the Live Activity grid.
 *
 * The grid gives every column the same width but each camera its own aspect
 * ratio, so a 16:9 tile next to a portrait fisheye leaves the short one
 * sitting in a hole the height of the tall one: a CSS grid row is as tall as
 * the tallest item in it, and `align-items: start` only stops the short tile
 * stretching, it does not shorten the row.
 *
 * The fix is to stop sharing rows. The grid gets a one pixel row unit and each
 * tile spans as many of those units as it is tall, so a tile's neighbour never
 * decides where the tile below it starts and auto-placement drops each tile
 * into the first free slot. That keeps the page's left-to-right, most recent
 * first order (unlike CSS multi-column, which would flow down column one
 * first) while removing the holes.
 *
 * The height itself is the same sum Montage computes in `calculateHeightUnits`
 * (useMontageGrid): the video area sized from the camera's ratio, plus the
 * card header above it.
 */

import { getMonitorAspectRatio } from './monitor-rotation';
import { LIVE_ACTIVITY, MONITOR_UI, MONTAGE_GRID } from '../zmninja-ng-constants';

/** The monitor fields a tile's shape is derived from. */
export interface TileShapeSource {
  Width: string;
  Height: string;
  Orientation: string | null;
}

/**
 * Height per unit of width for an `<w> / <h>` aspect ratio string, the form
 * getMonitorAspectRatio returns. Undefined for anything unparseable, so the
 * caller can fall back rather than compute a zero height tile.
 */
const parseHeightPerWidth = (ratio: string): number | undefined => {
  const [rawWidth, rawHeight] = ratio.split('/');
  const width = Number(rawWidth);
  const height = Number(rawHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return height / width;
};

/**
 * How many grid row units one tile occupies.
 *
 * Always at least one: ZoneMinder reporting unusable dimensions already falls
 * back to MONITOR_UI.fallbackAspectRatio, and the header alone keeps the sum
 * above zero even before that, so no tile can collapse to nothing.
 */
export function getLiveActivityRowSpan(
  monitor: TileShapeSource,
  containerWidth: number,
  gridCols: number
): number {
  const ratio =
    getMonitorAspectRatio(monitor.Width, monitor.Height, monitor.Orientation) ??
    MONITOR_UI.fallbackAspectRatio;
  const heightPerWidth =
    parseHeightPerWidth(ratio) ?? parseHeightPerWidth(MONITOR_UI.fallbackAspectRatio) ?? 0;

  const cols = Math.max(1, Math.round(gridCols));
  const columnWidth = Number.isFinite(containerWidth) && containerWidth > 0
    ? containerWidth / cols
    : 0;
  const heightPx = columnWidth * heightPerWidth + MONTAGE_GRID.cardHeaderHeightPx;

  // Rounded up, never down: a span shorter than the tile's own height would
  // let the tile overflow its rows and overlap whatever auto-placement puts
  // underneath it.
  return Math.max(1, Math.ceil(heightPx / LIVE_ACTIVITY.rowUnitPx));
}
