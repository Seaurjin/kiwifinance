import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The workspace packages export TypeScript source rather than a build, so the
// app compiles them itself. One less build step between a change and seeing it.
const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@kiwi/core': pkg('core'),
      '@kiwi/ledger': pkg('ledger'),
      '@kiwi/metrics': pkg('metrics'),
      '@kiwi/report-spec': pkg('report-spec'),
      '@kiwi/client': pkg('client'),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787', '/health': 'http://localhost:8787' },
  },
});
