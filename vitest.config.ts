import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@kiwi/core': pkg('core'),
      '@kiwi/ledger': pkg('ledger'),
      '@kiwi/metrics': pkg('metrics'),
      '@kiwi/model-router': pkg('model-router'),
      '@kiwi/report-spec': pkg('report-spec'),
      '@kiwi/planner': pkg('planner'),
      '@kiwi/store': pkg('store'),
      '@kiwi/client': pkg('client'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    server: {
      deps: {
        // node:sqlite is still flagged experimental, so it is missing from
        // module.builtinModules and Vite tries to resolve it from disk.
        external: [/^node:sqlite$/],
      },
    },
  },
});
