import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // Component tests (.test.tsx) opt into a DOM with a per-file
    // "@vitest-environment jsdom" docblock; pure-logic tests stay on node.
  },
});
