/**
 * Zone Overlay Component
 *
 * Renders detection zones as semi-transparent polygon overlays
 * on top of a video player or image. Read-only visualization.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Zone } from '../../api/types';
import type { MonitorRotation } from '../../lib/monitor-rotation';
import {
  getZoneColor,
  coordsToSvgPointsWithTransform,
  getOrientedDimensions,
  parseZoneCoords,
  type ZoneTransform,
} from '../../lib/zone-utils';

interface ZoneOverlayProps {
  /** Array of zones to display */
  zones: Zone[];
  /** Width of the monitor in pixels (original, before rotation) */
  monitorWidth: number;
  /** Height of the monitor in pixels (original, before rotation) */
  monitorHeight: number;
  /** Monitor rotation applied to the video */
  rotation: MonitorRotation;
  /** Current monitor ID to filter zones */
  monitorId: string;
  /** Whether the overlay is visible */
  visible: boolean;
}

/**
 * ZoneOverlay component.
 * Renders zone polygons as an SVG overlay.
 */
export function ZoneOverlay({
  zones,
  monitorWidth,
  monitorHeight,
  rotation,
  monitorId,
  visible,
}: ZoneOverlayProps) {
  const { t } = useTranslation();
  const [hoveredZoneId, setHoveredZoneId] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Rendered pixels per viewBox unit, so the hover label can be sized to a
  // fixed on-screen pixel size (like the HTML legend) instead of scaling with
  // the monitor resolution. Measured from the SVG's actual rendered size.
  const [pxPerUnit, setPxPerUnit] = useState(0);

  // Filter zones to only show zones for this monitor
  const filteredZones = useMemo(() => {
    return zones.filter((zone) => String(zone.MonitorId) === String(monitorId));
  }, [zones, monitorId]);

  // Calculate transformation and oriented dimensions
  const { transform, viewBoxWidth, viewBoxHeight } = useMemo(() => {
    const t: ZoneTransform = {
      rotation,
      originalWidth: monitorWidth,
      originalHeight: monitorHeight,
    };
    const oriented = getOrientedDimensions(monitorWidth, monitorHeight, rotation);
    return {
      transform: t,
      viewBoxWidth: oriented.width,
      viewBoxHeight: oriented.height,
    };
  }, [rotation, monitorWidth, monitorHeight]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el || !viewBoxWidth || !viewBoxHeight) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setPxPerUnit(Math.min(rect.width / viewBoxWidth, rect.height / viewBoxHeight));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewBoxWidth, viewBoxHeight, visible]);

  if (!visible || filteredZones.length === 0) {
    return null;
  }

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full"
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      preserveAspectRatio="xMidYMid meet"
      data-testid="zone-overlay"
    >
      {filteredZones.map((zone) => {
        const points = coordsToSvgPointsWithTransform(zone.Coords, transform);
        const color = getZoneColor(zone.Type);
        const isHovered = hoveredZoneId === zone.Id;

        return (
          <g key={zone.Id}>
            <polygon
              points={points}
              fill={color}
              fillOpacity={isHovered ? 0.5 : 0.3}
              stroke={color}
              strokeWidth={isHovered ? 3 : 2}
              strokeOpacity={0.8}
              className="transition-all duration-150 cursor-pointer"
              onMouseEnter={() => setHoveredZoneId(zone.Id)}
              onMouseLeave={() => setHoveredZoneId(null)}
              data-testid={`zone-polygon-${zone.Id}`}
            />
            {/* Zone label - shown on hover */}
            {isHovered && (
              <ZoneLabel
                zone={zone}
                color={color}
                transform={transform}
                t={t}
                pxPerUnit={pxPerUnit}
                viewBoxWidth={viewBoxWidth}
                viewBoxHeight={viewBoxHeight}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Zone label component shown on hover.
 */
function ZoneLabel({ zone, color, transform, t, pxPerUnit, viewBoxWidth, viewBoxHeight }: {
  zone: Zone; color: string; transform: ZoneTransform;
  t: (key: string) => string;
  pxPerUnit: number; viewBoxWidth: number; viewBoxHeight: number;
}) {
  const center = calculatePolygonCenter(zone.Coords, transform);
  const typeLabel = t(`monitor_detail.zone_type.${zone.Type.toLowerCase()}`);

  // Convert a target on-screen pixel size to viewBox units so the label renders
  // at a fixed size on screen (matching the HTML legend), regardless of the
  // monitor resolution. Fall back to a viewBox fraction before the first
  // measurement.
  const unitsFor = (px: number) =>
    pxPerUnit > 0 ? px / pxPerUnit : Math.max(viewBoxWidth, viewBoxHeight) * (px / 640);
  const nameFont = unitsFor(14);
  const typeFont = unitsFor(11);
  const padX = nameFont * 0.7;
  const padY = nameFont * 0.45;
  const lineGap = nameFont * 0.3;
  const dotR = nameFont * 0.32;

  // SVG text has no auto-sized background, so estimate the text width from the
  // character count (~0.62em per character) to size the box.
  const nameWidth = zone.Name.length * nameFont * 0.62 + dotR * 3;
  const typeWidth = typeLabel.length * typeFont * 0.62;
  const rectW = Math.max(nameWidth, typeWidth) + padX * 2;
  const rectH = nameFont + lineGap + typeFont + padY * 2;
  const rectX = center.x - rectW / 2;
  const rectY = center.y - rectH / 2;
  const nameBaseline = rectY + padY + nameFont * 0.85;
  const typeBaseline = nameBaseline + lineGap + typeFont * 0.9;
  const dotX = center.x - (zone.Name.length * nameFont * 0.62) / 2 - dotR * 1.5;

  return (
    <g className="select-none pointer-events-none">
      <rect
        x={rectX}
        y={rectY}
        width={rectW}
        height={rectH}
        fill="rgba(0, 0, 0, 0.78)"
        rx={nameFont * 0.3}
      />
      <circle cx={dotX} cy={nameBaseline - nameFont * 0.32} r={dotR} fill={color} />
      <text
        x={center.x}
        y={nameBaseline}
        textAnchor="middle"
        fill="white"
        fontSize={nameFont}
        fontWeight="600"
      >
        {zone.Name}
      </text>
      <text
        x={center.x}
        y={typeBaseline}
        textAnchor="middle"
        fill="#e5e7eb"
        fontSize={typeFont}
      >
        {typeLabel}
      </text>
    </g>
  );
}

/**
 * Calculates the centroid of a polygon from coords string, with transformation applied.
 */
function calculatePolygonCenter(coords: string, transform: ZoneTransform): { x: number; y: number } {
  const points = parseZoneCoords(coords);

  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  // Transform all points first, then calculate center
  const transformedPoints = points.map((p) => {
    const { rotation, originalWidth, originalHeight } = transform;

    if (rotation.kind !== 'degrees') {
      return p;
    }

    const degrees = ((rotation.degrees % 360) + 360) % 360;

    switch (degrees) {
      case 90:
        return { x: p.y, y: originalWidth - p.x };
      case 180:
        return { x: originalWidth - p.x, y: originalHeight - p.y };
      case 270:
        return { x: originalHeight - p.y, y: p.x };
      default:
        return p;
    }
  });

  const sumX = transformedPoints.reduce((sum, p) => sum + p.x, 0);
  const sumY = transformedPoints.reduce((sum, p) => sum + p.y, 0);

  return {
    x: Math.round(sumX / transformedPoints.length),
    y: Math.round(sumY / transformedPoints.length),
  };
}
