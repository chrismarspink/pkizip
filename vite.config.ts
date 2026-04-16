import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // GitHub Pages: chrismarspink.github.io/pkizip/
  base: '/pkizip/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'PKIZIP',
        short_name: 'PKIZIP',
        description: 'CMS-based encryption, signing, and compression PWA with mnemonic key management',
        display: 'standalone',
        theme_color: '#1DC078',
        background_color: '#ffffff',
        scope: '/pkizip/',
        start_url: '/pkizip/',
        icons: [
          { src: '/pkizip/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pkizip/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
