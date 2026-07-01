# Zone Type Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Color the Show Zones overlay by ZoneMinder zone type (not the per-zone AlarmRGB), add the zone type to the hover label, and show a color legend, so users can tell active zones from inactive ones (refs #208).

**Architecture:** `zone-utils.ts` already maps `ZoneType -> color`; refine three colors and add an ordered type list. `ZoneOverlay.tsx` drops the `AlarmRGB` precedence and colors by `getZoneColor(zone.Type)`, and adds the translated type to its hover label. A new `ZoneLegend` component renders in `MonitorDetail`'s outer (non-zoomed) container so it stays fixed under zoom.

**Tech Stack:** React, TypeScript, SVG, react-i18next, Tailwind, Vitest, @testing-library/react, Playwright (BDD).

## Global Constraints

- Run all `npm` commands from `app/`.
- Plain factual writing; no banned superlatives; no em-dashes.
- i18n all 5 languages: `en, de, es, fr, zh`. New keys under `monitor_detail.zone_type.*`.
- Never hardcode user-facing strings; zone type labels go through `t()`.
- Constants/palette live in `lib/zone-utils.ts`; import, do not redeclare.
- `data-testid="kebab-case"` on new asserted elements.
- Legend must be `pointer-events-none` so it never blocks zone hover or video controls.
- Text overflow: `truncate` + `min-w-0` in flex rows with text.
- Verify before commit: `npm test`, `npx tsc --noEmit`, `npm run build`; e2e for UI changes.
- Revert incidental native build-number bumps before committing (`app/android/app/build.gradle`, `app/ios/App/App.xcodeproj/project.pbxproj`).
- Reference the issue with `refs #208`.

**Palette (target):** Active `#22c55e`, Inclusive `#3b82f6`, Exclusive `#ef4444`, Preclusive `#f59e0b`, Inactive `#9ca3af`, Privacy `#a855f7`.

---

### Task 1: Palette refinement and type order in `zone-utils.ts`

**Files:**
- Modify: `app/src/lib/zone-utils.ts`
- Test: `app/src/lib/__tests__/zone-utils.test.ts`

**Interfaces:**
- Produces: updated `getZoneColor(type: ZoneType): string`; new `export const ZONE_TYPE_ORDER: ZoneType[]`.

- [ ] **Step 1: Write/extend the failing tests**

In `app/src/lib/__tests__/zone-utils.test.ts`, add (or adjust an existing `getZoneColor` block) these cases and a new import of `ZONE_TYPE_ORDER`:

```ts
import { getZoneColor, ZONE_TYPE_ORDER } from '../zone-utils';

describe('getZoneColor palette', () => {
  it('returns the refined palette per type', () => {
    expect(getZoneColor('Active')).toBe('#22c55e');
    expect(getZoneColor('Inclusive')).toBe('#3b82f6');
    expect(getZoneColor('Exclusive')).toBe('#ef4444');
    expect(getZoneColor('Preclusive')).toBe('#f59e0b');
    expect(getZoneColor('Inactive')).toBe('#9ca3af');
    expect(getZoneColor('Privacy')).toBe('#a855f7');
  });

  it('falls back to gray for an unknown type', () => {
    // @ts-expect-error intentional invalid type
    expect(getZoneColor('Nope')).toBe('#6b7280');
  });
});

describe('ZONE_TYPE_ORDER', () => {
  it('lists all six types in palette order', () => {
    expect(ZONE_TYPE_ORDER).toEqual([
      'Active', 'Inclusive', 'Exclusive', 'Preclusive', 'Inactive', 'Privacy',
    ]);
  });
});
```

If the file already asserts the old Preclusive/Inactive/Privacy hex values, update those expectations to the new values in the same edit.

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npm test -- zone-utils`
Expected: FAIL (old hex values / missing `ZONE_TYPE_ORDER`).

- [ ] **Step 3: Update the implementation**

In `app/src/lib/zone-utils.ts`, update the `zoneColors` map values and add the order list after it:

```ts
const zoneColors: Record<ZoneType, string> = {
  Active: '#22c55e',     // green-500
  Inclusive: '#3b82f6',  // blue-500
  Exclusive: '#ef4444',  // red-500
  Preclusive: '#f59e0b', // amber-500
  Inactive: '#9ca3af',   // gray-400
  Privacy: '#a855f7',    // purple-500
};

/** Zone types in palette order, for legend rows and stable ordering. */
export const ZONE_TYPE_ORDER: ZoneType[] = [
  'Active', 'Inclusive', 'Exclusive', 'Preclusive', 'Inactive', 'Privacy',
];
```

Leave `getZoneColor` and its `|| '#6b7280'` fallback unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npm test -- zone-utils`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/zone-utils.ts src/lib/__tests__/zone-utils.test.ts
git commit -m "feat: refine zone type palette and add ZONE_TYPE_ORDER (refs #208)"
```

---

### Task 2: Type-based color and type in hover label (`ZoneOverlay.tsx`)

**Files:**
- Modify: `app/src/components/monitors/ZoneOverlay.tsx`
- Test: `app/src/components/monitors/__tests__/ZoneOverlay.test.tsx` (create)

**Interfaces:**
- Consumes: `getZoneColor` (Task 1). Uses `t()` from `react-i18next`.
- Produces: overlay fill = `getZoneColor(zone.Type)`; hover label includes translated type.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/monitors/__tests__/ZoneOverlay.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoneOverlay } from '../ZoneOverlay';
import type { Zone } from '../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function zone(overrides: Partial<Zone>): Zone {
  return {
    Id: 1, MonitorId: 1, Name: 'Z1', Type: 'Active', Units: 'Pixels',
    NumCoords: 4, Coords: '0,0 100,0 100,100 0,100', Area: 10000,
    AlarmRGB: 16711680, // red
  } as unknown as Zone;
}

const base = {
  monitorWidth: 100, monitorHeight: 100,
  rotation: { kind: 'none' } as never, monitorId: '1', visible: true,
};

describe('ZoneOverlay', () => {
  it('colors an inactive zone by type (gray), ignoring red AlarmRGB', () => {
    render(<ZoneOverlay {...base} zones={[zone({ Id: 7, Type: 'Inactive' })]} />);
    const poly = screen.getByTestId('zone-polygon-7');
    expect(poly.getAttribute('fill')).toBe('#9ca3af');
    expect(poly.getAttribute('fill')).not.toBe('#ff0000');
  });

  it('colors different types differently', () => {
    render(
      <ZoneOverlay {...base} zones={[
        zone({ Id: 1, Type: 'Active' }),
        zone({ Id: 2, Type: 'Inactive' }),
      ]} />
    );
    expect(screen.getByTestId('zone-polygon-1').getAttribute('fill')).toBe('#22c55e');
    expect(screen.getByTestId('zone-polygon-2').getAttribute('fill')).toBe('#9ca3af');
  });

  it('shows the translated zone type in the hover label', () => {
    render(<ZoneOverlay {...base} zones={[zone({ Id: 3, Type: 'Preclusive' })]} />);
    fireEvent.mouseEnter(screen.getByTestId('zone-polygon-3'));
    expect(screen.getByText('monitor_detail.zone_type.preclusive')).toBeInTheDocument();
  });

  it('renders nothing when not visible', () => {
    render(<ZoneOverlay {...base} visible={false} zones={[zone({ Id: 1 })]} />);
    expect(screen.queryByTestId('zone-overlay')).not.toBeInTheDocument();
  });
});
```

Note: add `import { vi } from 'vitest';` if the project's vitest config does not expose globals (check an existing component test's imports and match it).

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npm test -- ZoneOverlay`
Expected: FAIL (fill is red from AlarmRGB; no type in label).

- [ ] **Step 3: Update `ZoneOverlay.tsx`**

- Remove `alarmRGBToHex` from the import from `../../lib/zone-utils` (keep the other named imports).
- Add at the top: `import { useTranslation } from 'react-i18next';`
- Inside the component body, add: `const { t } = useTranslation();`
- Change the fill resolution inside the `filteredZones.map(...)` from
  `const color = alarmRGBToHex(zone.AlarmRGB) || getZoneColor(zone.Type);`
  to:
  `const color = getZoneColor(zone.Type);`
- Pass `t` and the zone type into the label. Change the hover render to
  `{isHovered && <ZoneLabel zone={zone} color={color} transform={transform} t={t} />}`.
- Update `ZoneLabel` to show the type on a second line. Replace its signature and body:

```tsx
function ZoneLabel({ zone, color, transform, t }: {
  zone: Zone; color: string; transform: ZoneTransform;
  t: (key: string) => string;
}) {
  const center = calculatePolygonCenter(zone.Coords, transform);
  const typeLabel = t(`monitor_detail.zone_type.${zone.Type.toLowerCase()}`);

  return (
    <g>
      <rect
        x={center.x - 60}
        y={center.y - 16}
        width={120}
        height={34}
        fill="rgba(0, 0, 0, 0.75)"
        rx={4}
      />
      <text
        x={center.x}
        y={center.y - 1}
        textAnchor="middle"
        fill="white"
        fontSize="14"
        fontWeight="500"
        className="select-none pointer-events-none"
      >
        {zone.Name}
      </text>
      <text
        x={center.x}
        y={center.y + 13}
        textAnchor="middle"
        fill="#d1d5db"
        fontSize="11"
        className="select-none pointer-events-none"
      >
        {typeLabel}
      </text>
      <circle cx={center.x - 50} cy={center.y - 5} r={4} fill={color} />
    </g>
  );
}
```

The `ZoneLabel` prop type widens `t` to `(key: string) => string`, which the real
`TFunction` satisfies at the call site.

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npm test -- ZoneOverlay`
Expected: PASS (4 cases).

- [ ] **Step 5: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: PASS. (If `alarmRGBToHex` is now reported unused anywhere else, it is not,
it stays exported in zone-utils and is still covered by its own tests.)

- [ ] **Step 6: Commit**

```bash
cd app && git add src/components/monitors/ZoneOverlay.tsx src/components/monitors/__tests__/ZoneOverlay.test.tsx
git commit -m "feat: color zones by type and show type in hover label (refs #208)"
```

---

### Task 3: i18n zone type labels

**Files:**
- Modify: `app/src/locales/{en,de,es,fr,zh}/translation.json`

**Interfaces:**
- Produces: `monitor_detail.zone_type.{active,inclusive,exclusive,preclusive,inactive,privacy}`.

- [ ] **Step 1: Add the `zone_type` object**

In each file, inside the existing `monitor_detail` object (the one holding
`show_zones` / `hide_zones`), add:

```json
"zone_type": {
  "active": "<v>",
  "inclusive": "<v>",
  "exclusive": "<v>",
  "preclusive": "<v>",
  "inactive": "<v>",
  "privacy": "<v>"
}
```

Values per language:
- en: Active, Inclusive, Exclusive, Preclusive, Inactive, Privacy
- de: Aktiv, Inklusiv, Exklusiv, Präklusiv, Inaktiv, Privat
- es: Activa, Inclusiva, Exclusiva, Preclusiva, Inactiva, Privacidad
- fr: Active, Inclusive, Exclusive, Préclusive, Inactive, Confidentialité
- zh: 活动, 包含, 排除, 预排除, 非活动, 隐私

Mind the trailing comma on the preceding member. Do not duplicate `monitor_detail`.

- [ ] **Step 2: Validate JSON**

Run: `cd app && for f in en de es fr zh; do node -e "const j=require('./src/locales/$f/translation.json'); console.log('$f', j.monitor_detail.zone_type.inactive)"; done`
Expected: each prints its Inactive value; no parse error.

- [ ] **Step 3: Commit**

```bash
cd app && git add src/locales/*/translation.json
git commit -m "i18n: add zone type labels in all 5 languages (refs #208)"
```

---

### Task 4: `ZoneLegend` component and MonitorDetail integration

**Files:**
- Create: `app/src/components/monitors/ZoneLegend.tsx`
- Test: `app/src/components/monitors/__tests__/ZoneLegend.test.tsx`
- Modify: `app/src/pages/MonitorDetail.tsx`

**Interfaces:**
- Consumes: `getZoneColor`, `ZONE_TYPE_ORDER` (Task 1); `Zone` type; `t()`.
- Produces: `<ZoneLegend zones={Zone[]} monitorId={string} visible={boolean} />`.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/monitors/__tests__/ZoneLegend.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ZoneLegend } from '../ZoneLegend';
import type { Zone } from '../../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const z = (Id: number, Type: string, MonitorId = 1): Zone =>
  ({ Id, MonitorId, Name: `Z${Id}`, Type, NumCoords: 4,
     Coords: '0,0 1,0 1,1 0,1' } as unknown as Zone);

describe('ZoneLegend', () => {
  it('shows one row per present type, in palette order', () => {
    render(<ZoneLegend visible monitorId="1" zones={[z(1, 'Inactive'), z(2, 'Active')]} />);
    expect(screen.getByTestId('zone-legend')).toBeInTheDocument();
    expect(screen.getByTestId('zone-legend-row-Active')).toBeInTheDocument();
    expect(screen.getByTestId('zone-legend-row-Inactive')).toBeInTheDocument();
    // Active precedes Inactive in the DOM (palette order)
    const rows = screen.getAllByTestId(/zone-legend-row-/);
    expect(rows[0].getAttribute('data-testid')).toBe('zone-legend-row-Active');
  });

  it('omits types not present', () => {
    render(<ZoneLegend visible monitorId="1" zones={[z(1, 'Active')]} />);
    expect(screen.queryByTestId('zone-legend-row-Privacy')).not.toBeInTheDocument();
  });

  it('filters to the current monitor', () => {
    render(<ZoneLegend visible monitorId="1" zones={[z(1, 'Active', 2)]} />);
    expect(screen.queryByTestId('zone-legend')).not.toBeInTheDocument();
  });

  it('renders nothing when not visible', () => {
    render(<ZoneLegend visible={false} monitorId="1" zones={[z(1, 'Active')]} />);
    expect(screen.queryByTestId('zone-legend')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npm test -- ZoneLegend`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `ZoneLegend.tsx`**

```tsx
/**
 * Zone Legend
 *
 * Small color key for the Show Zones overlay. Lists the zone types present on
 * the current monitor with their palette color and translated label. Fixed
 * position, non-interactive, shown only while the overlay is visible.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Zone } from '../../api/types';
import { getZoneColor, ZONE_TYPE_ORDER } from '../../lib/zone-utils';

interface ZoneLegendProps {
  zones: Zone[];
  monitorId: string;
  visible: boolean;
}

export function ZoneLegend({ zones, monitorId, visible }: ZoneLegendProps) {
  const { t } = useTranslation();

  const presentTypes = useMemo(() => {
    const present = new Set(
      zones
        .filter((zone) => String(zone.MonitorId) === String(monitorId))
        .map((zone) => zone.Type)
    );
    return ZONE_TYPE_ORDER.filter((type) => present.has(type));
  }, [zones, monitorId]);

  if (!visible || presentTypes.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute bottom-2 left-2 z-10 flex flex-col gap-1 rounded bg-black/60 px-2 py-1.5 pointer-events-none"
      data-testid="zone-legend"
    >
      {presentTypes.map((type) => (
        <div
          key={type}
          className="flex items-center gap-1.5 min-w-0"
          data-testid={`zone-legend-row-${type}`}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: getZoneColor(type) }}
          />
          <span className="text-[10px] text-white/90 truncate min-w-0">
            {t(`monitor_detail.zone_type.${type.toLowerCase()}`)}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npm test -- ZoneLegend`
Expected: PASS (4 cases).

- [ ] **Step 5: Wire into `MonitorDetail.tsx`**

- Add import near the other monitor component imports:
  `import { ZoneLegend } from '../components/monitors/ZoneLegend';`
- Render the legend as a sibling of the `monitor-zoom-content` div (a direct child
  of the `Card`, so it is not affected by zoom/pan), right after the closing
  `</div>` of `monitor-zoom-content` and before the protocol-label block:

```tsx
          </div>
          <ZoneLegend
            zones={zones}
            monitorId={monitor.Monitor.Id}
            visible={showZones && !isZonesLoading}
          />
          {settings.showProtocolLabel && (
```

- [ ] **Step 6: Typecheck and build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: PASS / exit 0.

- [ ] **Step 7: Commit**

```bash
cd app && git add src/components/monitors/ZoneLegend.tsx src/components/monitors/__tests__/ZoneLegend.test.tsx src/pages/MonitorDetail.tsx
git commit -m "feat: zone color legend on monitor detail (refs #208)"
```

---

### Task 5: E2E for the zone overlay and legend

**Files:**
- Modify: `app/tests/features/monitor-detail.feature`
- Modify: the matching steps file (confirm: `app/tests/steps/monitor-detail.steps.ts` or similar)

**Interfaces:**
- Consumes: `data-testid` `zone-overlay`, `zone-legend`, and the existing Show Zones toggle.

- [ ] **Step 1: Confirm feature and steps filenames**

Run: `cd app && ls tests/features | grep -i monitor; ls tests/steps | grep -i monitor`
Use the actual names. Read `monitor-detail.feature` to reuse its login + open-monitor phrasing verbatim.

- [ ] **Step 2: Add a scenario**

Append to `monitor-detail.feature`, matching existing step phrasing (find the Show
Zones toggle testid by grepping the page: `grep -n "show_zones\|zones-toggle\|data-testid" app/src/pages/MonitorDetail.tsx`). Example shape:

```gherkin
@all
Scenario: Zones show colored by type with a legend
  Given I am logged into zmNinjaNg
  When I open the first monitor
  And I toggle Show Zones on
  Then the zone overlay and legend should be visible if the monitor has zones
  When I toggle Show Zones off
  Then the zone overlay should not be visible
```

- [ ] **Step 3: Add step definitions (conditional pattern)**

In the steps file, using raw Playwright `page` to match the file's style. A monitor
may have no zones, so gate the positive assertion:

```ts
When('I toggle Show Zones on', async ({ page }) => {
  const toggle = page.getByTestId('toggle-zones'); // use the real testid from Step 2
  await toggle.click();
});

Then('the zone overlay and legend should be visible if the monitor has zones', async ({ page }) => {
  const overlay = page.getByTestId('zone-overlay');
  if (await overlay.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(page.getByTestId('zone-legend')).toBeVisible();
  }
  // else: this monitor has no zones; nothing to assert.
});

When('I toggle Show Zones off', async ({ page }) => {
  await page.getByTestId('toggle-zones').click();
});

Then('the zone overlay should not be visible', async ({ page }) => {
  await expect(page.getByTestId('zone-overlay')).toHaveCount(0);
});
```

Reuse existing "Given I am logged into zmNinjaNg" and monitor-open steps; do not
redefine them. If the Show Zones control lacks a `data-testid`, add
`data-testid="toggle-zones"` to that button in `MonitorDetail.tsx` in this task and
note it in the commit.

- [ ] **Step 4: Run the e2e feature**

Run: `cd app && npm run test:e2e -- monitor-detail.feature`
Expected: the new scenario passes on web-chromium (or no-ops cleanly if the test
server's first monitor has no zones).

- [ ] **Step 5: Commit**

```bash
cd app && git add tests/features/monitor-detail.feature tests/steps/ src/pages/MonitorDetail.tsx
git commit -m "test: e2e for zone type colors and legend (refs #208)"
```

---

### Task 6: Docs

**Files:**
- Modify: `docs/developer-guide/12-shared-services-and-components.rst` (the chapter documenting `ZoneOverlay` / `zone-utils`; confirm with grep)
- Modify: the monitor-detail / Show Zones section of the user guide (confirm filename)

- [ ] **Step 1: Developer guide**

Run from repo root: `grep -rln "ZoneOverlay\|zone-utils\|getZoneColor" docs/developer-guide`. In the section that covers zones, state that overlay color comes from the zone type via `getZoneColor`, list the palette (Active green, Inclusive blue, Exclusive red, Preclusive amber, Inactive gray, Privacy purple), and describe `ZoneLegend` (present types only, fixed position, `pointer-events-none`). Note `AlarmRGB` is no longer used for the overlay but `alarmRGBToHex` remains available.

- [ ] **Step 2: User guide**

Run from repo root: `grep -rln "Show Zones\|zones" docs/user-guide`. In the monitor-detail section, add that zones are colored by type with a legend, and inactive zones appear gray.

- [ ] **Step 3: Lint docs**

Run from repo root, on each edited file:
```bash
grep -niE "\b(comprehensive|robust|powerful|seamless|intuitive|user.friendly)\b" <file>
grep -n "—" <file>
```
Both must be zero. Fix any hits.

- [ ] **Step 4: Commit**

```bash
git add docs/developer-guide docs/user-guide
git commit -m "docs: document zone type colors and legend (refs #208)"
```

---

### Task 7: Full verification pass

**Files:** none.

- [ ] **Step 1: Unit tests** — `cd app && npm test` (all pass).
- [ ] **Step 2: Typecheck** — `cd app && npx tsc --noEmit` (clean).
- [ ] **Step 3: Build** — `cd app && npm run build` (exit 0).
- [ ] **Step 4: Revert native build-number bumps** — from repo root: `git status --short app/android/app/build.gradle app/ios/App/App.xcodeproj/project.pbxproj`; if modified, `git checkout -- <those files>`.
- [ ] **Step 5: E2E (web)** — `cd app && npm run test:e2e -- monitor-detail.feature` (pass).
- [ ] **Step 6: State the verification result** and note that the overlay/legend colors are a visual change worth an on-device look (iOS/Android/desktop) before closing #208. Delete this plan file and the spec after the feature is confirmed complete.

---

## Notes for the implementer

- The legend must live in `MonitorDetail`'s outer `Card` container, not inside the
  zoom/pan `monitor-zoom-content` div, or it will scale with zoom.
- Do not add a toggle to color by `AlarmRGB` (out of scope).
- Zone types are ZoneMinder domain terms; keep translated labels short so legend
  rows and hover labels stay compact.
