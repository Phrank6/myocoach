import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static site: no server code, so `npm run build` output can be hosted anywhere and opened on a phone.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  preview: { port: 4174 },
});
