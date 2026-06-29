import { describe, expect, it } from 'vitest';
import {
  type AccentColorName,
  accentColors,
  lightBadgeTintAlpha,
  lightFg,
  lightSurfaces,
} from './theme-colors';

/* ── WCAG contrast helpers ────────────────────────────────────────────── */

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relLuminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const l1 = relLuminance(a);
  const l2 = relLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `fg` at alpha `a` over opaque `bg`. */
function composite(fg: Rgb, a: number, bg: Rgb): Rgb {
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
  ] as Rgb;
}

/* ── Surfaces under test (single-sourced from theme-colors) ────────────── */

// The Requests list and log rows render inside surface.panel in light theme.
const LIGHT_PANEL = hexToRgb(lightSurfaces.panel);
const AA_NORMAL = 4.5;
// Secondary text (timestamps, the Kind column, counts) uses fg.dim. It need not
// hit AA, but it must clear this legibility floor so it isn't washed out — the
// previous gray (#9ca3af) only managed ~2.3:1 on the panel, the harsh/washed-out
// complaint this refinement fixes.
const DIM_FLOOR = 3.0;

const names = Object.keys(accentColors) as AccentColorName[];

describe('light-theme accent/status colors meet WCAG AA on the light panel', () => {
  it.each(names)('color "%s" text is AA on surface.panel', (name) => {
    const text = hexToRgb(accentColors[name].light);
    const ratio = contrast(text, LIGHT_PANEL);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('HTTP status badges stay AA on their light tint', () => {
  // 2xx/3xx/4xx/5xx badge text sits on a faint tint of its own hue over the panel.
  const badgeTints: Array<[string, AccentColorName]> = [
    ['2xx', 'green'],
    ['3xx', 'blue'],
    ['4xx', 'yellow'],
    ['5xx', 'red'],
  ];

  it.each(badgeTints)('%s badge text is AA on its tinted background', (_label, color) => {
    const text = hexToRgb(accentColors[color].light);
    const tinted = composite(text, lightBadgeTintAlpha, LIGHT_PANEL);
    const ratio = contrast(text, tinted);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('light foreground ramp is legible (not washed out)', () => {
  it('fg.dim clears the legibility floor on the panel', () => {
    const ratio = contrast(hexToRgb(lightFg.dim), LIGHT_PANEL);
    expect(ratio).toBeGreaterThanOrEqual(DIM_FLOOR);
  });

  it('fg.DEFAULT and fg.bright are strong body/heading contrast (AA+)', () => {
    expect(contrast(hexToRgb(lightFg.DEFAULT), LIGHT_PANEL)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrast(hexToRgb(lightFg.bright), LIGHT_PANEL)).toBeGreaterThanOrEqual(7);
  });

  it('fg.bright is softened slate, not pure black (glare)', () => {
    expect(lightFg.bright.toLowerCase()).not.toBe('#000000');
  });
});

describe('light surfaces soften glare (not pure white)', () => {
  it('reading surfaces are off-white, never #fff', () => {
    for (const surface of [lightSurfaces.panel, lightSurfaces.bg]) {
      expect(surface.toLowerCase()).not.toBe('#ffffff');
      expect(surface.toLowerCase()).not.toBe('#fff');
    }
  });

  it('the app backdrop sits a step below the panel (gentle elevation)', () => {
    // bg darker than panel ⇒ panels read as raised rather than floating on white.
    expect(relLuminance(hexToRgb(lightSurfaces.bg))).toBeLessThan(
      relLuminance(hexToRgb(lightSurfaces.panel)),
    );
  });
});

describe('dark-theme palette is preserved (regression guard)', () => {
  // Dark values are the historical palette; the fix must not change them.
  it('keeps the original dark accent values', () => {
    expect(accentColors.green.dark).toBe('#6ee7b7');
    expect(accentColors.yellow.dark).toBe('#fcd34d');
    expect(accentColors.red.dark).toBe('#fca5a5');
    expect(accentColors.blue.dark).toBe('#93c5fd');
    expect(accentColors.accent.dark).toBe('#5eead4');
  });
});
