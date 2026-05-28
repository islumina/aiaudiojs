import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "happy-dom",
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 100,
        lines: 100,
      },
    },
    typecheck: {
      enabled: false,
    },
  },
});
