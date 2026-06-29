import { defineConfig } from '@pandacss/dev';
import {
  accentColors,
  lightBorders,
  lightFg,
  lightSurfaces,
} from './src/styles/theme-colors';

/** Build semantic color tokens (base = dark, _light = light override) from the
 *  shared accent palette so config and the contrast test share one source. */
const accentSemanticTokens = Object.fromEntries(
  Object.entries(accentColors).map(([name, { dark, light }]) => [
    name,
    { value: { base: dark, _light: light } },
  ]),
);

export default defineConfig({
  preflight: false,
  jsxFramework: 'preact',
  include: ['./src/**/*.{ts,tsx}'],
  outdir: 'styled-system',

  conditions: {
    light: '[data-theme="light"] &',
    dark: '[data-theme="dark"] &',
  },

  theme: {
    tokens: {
      colors: {
        neutral: {
          50: { value: '#f9fafb' },
          100: { value: '#f3f4f6' },
          200: { value: '#e5e7eb' },
          300: { value: '#d1d5db' },
          400: { value: '#9ca3af' },
          500: { value: '#6b7280' },
          600: { value: '#4b5563' },
          700: { value: '#282c34' },
          800: { value: '#1c1f26' },
          900: { value: '#14161b' },
          950: { value: '#0e1015' },
        },
        // Accent / status colors live in semanticTokens (theme-aware) below.
        white: { value: '#f9fafb' },
      },
      fonts: {
        mono: { value: "'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace" },
        sans: { value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" },
      },
      fontSizes: {
        xs: { value: '10px' },
        sm: { value: '11px' },
        md: { value: '12px' },
        lg: { value: '13px' },
        xl: { value: '14px' },
        '2xl': { value: '16px' },
        '3xl': { value: '20px' },
      },
      spacing: {
        0: { value: '0' },
        0.5: { value: '2px' },
        1: { value: '4px' },
        1.5: { value: '6px' },
        2: { value: '8px' },
        3: { value: '12px' },
        4: { value: '16px' },
        5: { value: '20px' },
        6: { value: '24px' },
        8: { value: '32px' },
      },
      radii: {
        sm: { value: '4px' },
        md: { value: '6px' },
        lg: { value: '8px' },
        xl: { value: '12px' },
        full: { value: '9999px' },
      },
      zIndex: {
        base: { value: '0' },
        sticky: { value: '10' },
        dropdown: { value: '50' },
        overlay: { value: '100' },
        modal: { value: '200' },
        toast: { value: '300' },
      },
    },
    semanticTokens: {
      colors: {
        // Theme-aware accent / status palette. Dark values are the historical
        // palette; light values are darker/more saturated to meet WCAG AA on the
        // light panel for method/status labels. See theme-colors.ts.
        ...accentSemanticTokens,
        // Light surfaces/foreground/borders are single-sourced from
        // theme-colors.ts (so the contrast test asserts against the same values).
        // `base` (dark) keeps referencing the shared neutral scale — unchanged.
        surface: {
          bg: {
            value: { base: '{colors.neutral.950}', _light: lightSurfaces.bg },
          },
          panel: {
            value: { base: '{colors.neutral.900}', _light: lightSurfaces.panel },
          },
          hover: {
            value: { base: '{colors.neutral.800}', _light: lightSurfaces.hover },
          },
          raised: {
            value: { base: '{colors.neutral.700}', _light: lightSurfaces.raised },
          },
        },
        border: {
          subtle: {
            value: { base: 'rgba(255,255,255,0.06)', _light: lightBorders.subtle },
          },
          strong: {
            value: { base: 'rgba(255,255,255,0.12)', _light: lightBorders.strong },
          },
        },
        fg: {
          DEFAULT: {
            value: { base: '{colors.neutral.300}', _light: lightFg.DEFAULT },
          },
          dim: {
            value: { base: '{colors.neutral.500}', _light: lightFg.dim },
          },
          bright: {
            value: { base: '{colors.white}', _light: lightFg.bright },
          },
        },
      },
    },
  },
});
