import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
      // `import "server-only"` throws outside a React server bundle; tests run platform code directly.
      "server-only": `${import.meta.dirname}/tests/empty.ts`,
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    env: { DATABASE_URL: "file:./test.db", SESSION_SECRET: "test-secret" },
    fileParallelism: false,
  },
});
