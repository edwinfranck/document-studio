import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = `http://127.0.0.1:${process.env.STUDIO_PORT || 4317}`;
export default defineConfig({
  plugins: [react()],
  server: { port: 5317, strictPort: true, proxy: { '/api': API, '/fonts': API, '/vendor': API } },
  build: { chunkSizeWarningLimit: 2500 },
});
