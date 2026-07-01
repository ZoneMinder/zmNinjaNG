# Zone type colors in the Show Zones overlay (#208)

## Problem

The Show Zones overlay draws every zone in the same red translucent color, so a
user cannot tell active zones from inactive (disabled) ones, or distinguish the
other ZoneMinder zone types. Issue #208 asks for a different color per zone type,
at minimum inactive zones shown in a distinct (gray) color.

## Root cause

A color-by-type map already exists in `app/src/lib/zone-utils.ts` (`zoneColors`),
but `ZoneOverlay.tsx` resolves the fill as:

```
const color = alarmRGBToHex(zone.AlarmRGB) || getZoneColor(zone.Type);
```

`AlarmRGB` is ZoneMinder's per-zone color. It defaults to red (0xFF0000) and is
almost never customized, so it always wins and the type map is never used. Every
zone renders red.

## Decisions

- **Color by zone type.** Drop the `AlarmRGB` precedence; the overlay colors each
  zone by its `Type` via `getZoneColor`. `AlarmRGB` is ignored for the overlay.
- **Refined palette** (three colors changed from the current map for visibility on
  dark or busy video at 0.3 fill opacity):

  | Type | ZM meaning | Color | Hex |
  |---|---|---|---|
  | Active | Primary motion detection (enabled) | Green | `#22c55e` |
  | Inclusive | Alarms only if another zone also alarms | Blue | `#3b82f6` |
  | Exclusive | Alarms only if no other zone alarms | Red | `#ef4444` |
  | Preclusive | Blocks other zones when it alarms | Amber | `#f59e0b` |
  | Inactive | Disabled | Gray | `#9ca3af` |
  | Privacy | Permanently masked area | Purple | `#a855f7` |

  Changed from current: Preclusive `#eab308` -> `#f59e0b`, Inactive `#6b7280` ->
  `#9ca3af`, Privacy `#000000` -> `#a855f7`. Active/Inclusive/Exclusive unchanged.

- **Hover label shows the type.** The existing hover label (zone name + color dot)
  gains a second line with the translated zone type.
- **Legend key.** While the overlay is visible, a compact legend lists the zone
  types present in the current monitor's zones, each with its color swatch and
  translated label.
- **`AlarmRGB` / `alarmRGBToHex`.** `alarmRGBToHex` loses its only caller. Keep the
  pure function and its unit tests in `zone-utils.ts` (harmless, no behavior), but
  remove its import and use from `ZoneOverlay.tsx`. No toggle to restore AlarmRGB
  coloring (YAGNI; can be added later if requested).

## Changes

### `app/src/lib/zone-utils.ts`
Update the three color values in the `zoneColors` map to the palette above. Keep
`getZoneColor` and the `Record<ZoneType, string>` shape. No signature changes.

### `app/src/components/monitors/ZoneOverlay.tsx`
- Replace the fill resolution with `const color = getZoneColor(zone.Type);`.
  Remove the `alarmRGBToHex` import.
- Hover label: add the translated zone type as a second text line under the name.
  Widen the label background rect and adjust text baselines so both lines fit.
  Translate via `t(\`monitor_detail.zone_type.${zone.Type.toLowerCase()}\`)`.
  Add `useTranslation` to the component (it does not currently use it).
- Render a legend. Because the component returns an `<svg>`, wrap the output in a
  fragment and add the legend as an absolutely-positioned HTML `<div>` sibling
  (the parent video container in `MonitorDetail` is `relative`). The legend:
  - lists the distinct `Type` values among `filteredZones`, in the palette's order
    (Active, Inclusive, Exclusive, Preclusive, Inactive, Privacy),
  - each row: an inline color swatch (the type's color) + the translated label,
  - positioned bottom-left, small, semi-transparent dark background, rounded,
    `pointer-events-none` so it never blocks zone hover or video controls,
  - `data-testid="zone-legend"`, each row `data-testid="zone-legend-row-<type>"`,
  - renders only when `visible` and `filteredZones.length > 0` (same guard as the
    SVG; when the guard fails the component returns `null` as it does today).

  Keep the legend logic small. If `ZoneOverlay.tsx` grows past a clean size,
  extract the legend into a `ZoneLegend` subcomponent in the same file.

### i18n: `app/src/locales/{en,de,es,fr,zh}/translation.json`
Add a `zone_type` object inside the existing `monitor_detail` object (the one that
already holds `show_zones` / `hide_zones`), with keys `active`, `inclusive`,
`exclusive`, `preclusive`, `inactive`, `privacy`. Suggested values:

- en: Active, Inclusive, Exclusive, Preclusive, Inactive, Privacy
- de: Aktiv, Inklusiv, Exklusiv, Präklusiv, Inaktiv, Privat
- es: Activa, Inclusiva, Exclusiva, Preclusiva, Inactiva, Privacidad
- fr: Active, Inclusive, Exclusive, Préclusive, Inactive, Confidentialité
- zh: 活动, 包含, 排除, 预排除, 非活动, 隐私

These are ZoneMinder domain terms; keep translations short (they appear in the
legend and hover label). Adjust wording if a shorter native term reads better.

## Testing

**Unit - `app/src/lib/__tests__/zone-utils.test.ts`** (extend):
- `getZoneColor` returns the new hex for each of the 6 types (Active green,
  Preclusive `#f59e0b`, Inactive `#9ca3af`, Privacy `#a855f7`, etc.).
- Unknown type falls back to gray (existing default behavior).
- Keep the `alarmRGBToHex` tests unchanged (function retained).

**Unit - `app/src/components/monitors/__tests__/ZoneOverlay.test.tsx`**
(create if absent; otherwise extend). Mock `react-i18next` so `t` returns the key.
- A zone with `Type: 'Inactive'` and `AlarmRGB` set to red (16711680) renders its
  polygon with the gray type color, not red. This is the core #208 assertion:
  the fill is `getZoneColor('Inactive')`, proving AlarmRGB no longer wins.
- Two zones of different types render with different fills.
- The legend (`zone-legend`) renders a row only for each type present, in palette
  order, and not for absent types.
- When `visible` is false or there are no zones for the monitor, neither the SVG
  nor the legend renders.

**E2E - `app/tests/features/monitors.feature`** (or the monitor-detail feature;
confirm the filename). Reuse existing login + open-monitor steps. Toggle Show
Zones; assert `zone-overlay` and `zone-legend` become visible, and hide again when
toggled off. Use the conditional pattern if a monitor with zones is not guaranteed
on the test server.

## Docs

- `docs/developer-guide/12-shared-services-and-components.rst` (or the chapter that
  documents `ZoneOverlay` / `zone-utils`): note that overlay color is driven by
  zone type via `getZoneColor`, list the palette, and describe the legend.
- User guide (monitor detail / Show Zones section): note that zones are colored by
  type with a legend, and that inactive zones appear gray.

## Out of scope

- A toggle to color by each zone's own `AlarmRGB` (not requested; YAGNI).
- Editing zones or changing zone colors from the app.
- Changing zone geometry, hover interaction, or the Show Zones button itself.
