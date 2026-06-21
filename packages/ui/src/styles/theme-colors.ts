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
  red: { dark: '#fca5a5', light: '#c81e1e' },
  blue: { dark: '#93c5fd', light: '#1d4ed8' },
  orange: { dark: '#fdba74', light: '#b23c0a' },
  purple: { dark: '#c4b5fd', light: '#6d28d9' },
  // Muted accent: soft teal — calm, non-aggressive on dark; darker teal on light.
  accent: { dark: '#5eead4', light: '#0f766e' },
} as const;

export type AccentColorName = keyof typeof accentColors;

/**
 * Alpha for the light-theme HTTP-status badge tint. Kept low so the colored
 * badge text effectively sits on the (near-panel) surface and stays AA, while
 * still reading as a tinted chip. The dark theme keeps its original tints.
 */
export const lightBadgeTintAlpha = 0.06;
