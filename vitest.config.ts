import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // video/src/variants/** is the short-form variation factory's pure core. It
    // imports nothing from Remotion, so it runs here in plain node. Including it
    // by path (rather than adding video/ to a tsconfig) keeps the Remotion
    // project's manual `cd video && npx tsc --noEmit` arrangement untouched.
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "video/src/**/*.test.ts"],
    // These are Playwright-style tests (they import @playwright/test) — they run
    // under `npx playwright test`, not vitest. tests/e2e/ holds the new e2e suite.
    exclude: [
      "node_modules",
      "tests/e2e/**",
      // CRM's ported unit tests need @testing-library/react + jsdom (not yet
      // wired). Deferred for v1 — see docs/CRM_PORT_AUDIT.md.
      "src/features/crm/**",
      "tests/inbox-email.test.ts",
      "tests/inbox-media.test.ts",
      "tests/verify-visual.test.ts",
      "tests/admin-audit.test.ts",
      "tests/admin-full-audit.test.ts",
      "tests/admin-impersonation.test.ts",
      "tests/data-separation.test.ts",
      "tests/analytics-page.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/core/**/*.ts", "src/integrations/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
