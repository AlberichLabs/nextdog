import path from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      'styled-system': path.resolve(__dirname, 'styled-system'),
    },
  },
  build: {
    outDir: 'dist',
    emptyDir: true,
  },
});
