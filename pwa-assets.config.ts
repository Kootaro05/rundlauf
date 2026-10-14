import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Erzeugt die App-Icons aus public/logo.svg: npx pwa-assets-generator
// Das Logo ist vollflächig, darum ohne zusätzlichen Rand.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0, resizeOptions: { background: '#1b5687' } },
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background: '#1b5687' } },
  },
  images: ['public/logo.svg'],
});
