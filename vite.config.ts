import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Neue Versionen werden beim nächsten Öffnen automatisch übernommen.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        name: 'Rundlauf-Analytics',
        short_name: 'Rundlauf',
        description: 'Live-Erfassung und Statistik für Rundlauf-Tischtennis mit Schwimmer, Kronen und Pot.',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a141d',
        theme_color: '#1b5687',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Nur die App selbst wird zwischengespeichert. Daten kommen immer frisch von Supabase.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,mp3}'],
        // Demo-Figuren braucht nur der Demo-Modus, nicht die installierte App
        globIgnores: ['**/demo-avatars/**'],
        navigateFallbackDenylist: [/^\/auth/, /^\/api\//],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});
