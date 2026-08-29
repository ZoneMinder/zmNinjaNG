/**
 * WCAG AA contrast on the theme tokens (I3: accessibility is never traded for
 * simplicity or speed).
 *
 * `text-muted-foreground` is the app-wide secondary-text class and destructive
 * is the delete and disconnect confirmations, so a token pair below 4.5:1 is
 * not a corner case, it is most of the screen. Five themes ship and nothing
 * checked any of them; cream secondary text sat at 3.16:1 on muted.
 *
 * Normal text needs 4.5:1 (WCAG 2.1 SC 1.4.3). Large text would allow 3:1, but
 * none of these pairs is large-text only.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const cssPath = path.resolve(__dirname, '../index.css');
const THEMES = [':root', '.dark', '.slate', '.amber', '.cream'] as const;
const MIN_RATIO = 4.5;

/** The pairs a user reads as normal body text. */
const PAIRS: Array<[fg: string, bg: string]> = [
  ['--foreground', '--background'],
  ['--card-foreground', '--card'],
  ['--muted-foreground', '--background'],
  ['--muted-foreground', '--card'],
  ['--muted-foreground', '--muted'],
  ['--destructive-foreground', '--destructive'],
];

/**
 * `--token: H S% L%` for one theme block.
 *
 * Matches the block that actually declares the palette, not merely the first
 * one with this selector: `:root` is also used earlier for safe-area and
 * toolbar variables, and matching that one silently yielded an empty palette.
 */
function readTheme(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blocks = [...css.matchAll(new RegExp(`\\n\\s*${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'g'))];
  const palettes = blocks
    .map((block) => {
      const tokens: Record<string, string> = {};
      for (const m of block[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
      return tokens;
    })
    .filter((tokens) => '--background' in tokens && '--foreground' in tokens);

  if (palettes.length !== 1) {
    throw new Error(`expected exactly one palette block for ${selector}, found ${palettes.length}`);
  }
  return palettes[0];
}

/** HSL string ("222.2 84% 4.9%") to sRGB channels in 0..1. */
function hslToRgb(value: string): [number, number, number] {
  const [h, s, l] = value.split(/\s+/).map((p) => parseFloat(p));
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lig - c / 2;
  const seg = Math.floor(((h % 360) + 360) % 360 / 60);
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg];
  return [r + m, g + m, b + m];
}

/** WCAG relative luminance. */
function luminance(value: string): number {
  const [r, g, b] = hslToRgb(value).map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

describe('theme tokens meet WCAG AA for normal text', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  it('computes a known ratio correctly', () => {
    // Black on white is 21:1. Without this the gate could pass by measuring
    // nothing (M2).
    expect(contrast('0 0% 0%', '0 0% 100%')).toBeCloseTo(21, 1);
  });

  for (const theme of THEMES) {
    describe(theme, () => {
      const tokens = readTheme(css, theme);
      for (const [fg, bg] of PAIRS) {
        it(`${fg} on ${bg}`, () => {
          expect(tokens[fg], `${theme} is missing ${fg}`).toBeDefined();
          expect(tokens[bg], `${theme} is missing ${bg}`).toBeDefined();
          const ratio = contrast(tokens[fg], tokens[bg]);
          expect(
            Number(ratio.toFixed(2)),
            `${theme} ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${MIN_RATIO}:1`,
          ).toBeGreaterThanOrEqual(MIN_RATIO);
        });
      }
    });
  }
});
