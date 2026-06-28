import { describe, expect, it } from 'vitest';
import { type AccentColorName, accentColors, lightBadgeTintAlpha } from './theme-colors';

/* ── WCAG contrast helpers ────────────────────────────────────────────── */

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relLuminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: RGB, b: RGB): number {
  const l1 = relLuminance(a);
  const l2 = relLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `fg` at alpha `a` over opaque `bg`. */
function composite(fg: RGB, a: number, bg: RGB): RGB {
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
  ] as RGB;
}

/* ── Surfaces under test (must mirror panda.config semanticTokens) ─────── */

// The Requests list and log rows render inside surface.panel in light theme.
const LIGHT_PANEL = hexToRgb('#f5f4f2');
const AA_NORMAL = 4.5;

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
