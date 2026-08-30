import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    // Mirrors the production Nginx setup: the panel always talks to a
    // same-origin /api/v1, so in dev Vite proxies it to the local NestJS API.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      // Uploaded media previews: the API exposes the uploads root under
      // /uploads, so the dev panel resolves the same paths as production.
      '/uploads': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
  preview: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  // html5-qrcode is isolated behind the on-demand camera scanner; it is never in the initial panel bundle.
  build: { chunkSizeWarningLimit: 750 },
});
