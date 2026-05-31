import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The HOST page must be cross-origin isolated for the embedded editor's
// SharedArrayBuffer to work — exactly what a real consumer must configure.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
