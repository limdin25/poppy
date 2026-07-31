import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The UGC Factory app is fully separate from the Elsie app at the repo root.
// It runs on port 5175 (Elsie owns 5174) and deploys as its own Vercel project.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5175 },
});
