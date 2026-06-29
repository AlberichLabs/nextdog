import path from 'node:path';
import process from 'node:process';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// The dev harness (scripts/dev.mjs) sets NEXTDOG_DEV_UI_PORT so the dashboard
// runs on a dedicated, predictable port (and fails loudly if it is taken).
// Standalone `pnpm --filter @nextdog/ui dev` keeps Vite's default behaviour.
const devUiPort = Number(process.env.NEXTDOG_DEV_UI_PORT);

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      'styled-system': path.resolve(__dirname, 'styled-system'),
    },
  },
  server: devUiPort ? { port: devUiPort, strictPort: true } : undefined,
  build: {
    outDir: 'dist',
    emptyDir: true,
  },
});
