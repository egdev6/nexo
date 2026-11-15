import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite-canvas',
  plugins: [react()],
  test: { environment: 'jsdom', include: ['scripts/canvas/generate.canvas.tsx'] },
});
