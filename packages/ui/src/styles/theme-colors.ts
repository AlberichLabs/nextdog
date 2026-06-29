/**
 * Accent / status color palette, split by theme.
 *
 * `dark` values are tuned for the dark surface (neutral.900/950) and are the
 * historical NextDog palette. `light` values are darker / more saturated so the
 * method (GET/PUT/…) and HTTP status labels stay legible on the light surface
 * (≈ #f5f4f2 panel). Each light value targets WCAG AA (≥ 4.5:1) for normal text
 * against the light panel — see theme-colors.test.ts.
 *
 * Single source of truth: panda.config.ts builds its semantic color tokens from
 * this map, and the contrast test asserts against the same values.
 */
export const accentColors = {
  green: { dark: '#6ee7b7', light: '#047857' },
  yellow: { dark: '#fcd34d', light: '#846407' },
  // Light red is a slightly muted brick (not a pure-saturated red) so it stays
  // AA-legible without vibrating against the off-white panel.
  red: { dark: '#fca5a5', light: '#b42318' },
  blue: { dark: '#93c5fd', light: '#1d4ed8' },
  orange: { dark: '#fdba74', light: '#b23c0a' },
  purple: { dark: '#c4b5fd', light: '#6d28d9' },
  // Muted accent: soft teal — calm, non-aggressive on dark; darker teal on light.
  accent: { dark: '#5eead4', light: '#0f766e' },
} as const;

export type AccentColorName = keyof typeof accentColors;

/**
 * Alpha for the light-theme HTTP-status / log-level badge tint. Kept low so the
 * colored badge text effectively sits on the (near-panel) surface and stays AA,
 * while still reading as a tinted chip. The dark theme keeps its original tints.
 */
export const lightBadgeTintAlpha = 0.06;

/**
 * Light-theme surface ramp. A subtle, slightly cool off-white set — the reading
 * `panel` is intentionally NOT pure white (softens glare), and `bg` sits a step
 * grayer so panels read as gently elevated rather than floating on a hard white
 * field. `hover` / `raised` are quiet gray fills for hover and active/selected.
 *
 * Single source of truth: panda.config.ts builds the `_light` value of each
 * `surface.*` semantic token from this map; the contrast test mirrors `panel`.
 */
export const lightSurfaces = {
  bg: '#e9edf3',
  panel: '#f5f7fa',
  hover: '#edf0f5',
  raised: '#e4e9f0',
} as const;

/**
 * Light-theme foreground ramp. Slate, not pure black: `bright` is slate-900
 * (high contrast but softer than #000 on the off-white panel), `DEFAULT` is
 * slate-700, and `dim` is slate-500 — legible secondary text (timestamps, the
 * Kind column, counts) instead of the previous washed-out gray. See the
 * contrast test for the `dim` legibility floor.
 */
export const lightFg = {
  bright: '#0f172a',
  DEFAULT: '#334155',
  dim: '#64748b',
} as const;

/**
 * Light-theme hairline borders — soft, slate-tinted (cool) rather than hard
 * black, so dividers and panel edges separate without the harsh look.
 */
export const lightBorders = {
  subtle: 'rgba(15, 23, 42, 0.07)',
  strong: 'rgba(15, 23, 42, 0.12)',
} as const;
