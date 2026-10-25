import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname),
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: { '/api': 'http://localhost:3000' }
  },
  build: {
    outDir: resolve(import.meta.dirname, '../../dist/web'),
    emptyOutDir: true
  }
});
