import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative Pfade, damit der Build auch in einem Unterordner (z. B. GitHub Pages) läuft.
  base: './',
  test: {
    environment: 'node',
  },
});
