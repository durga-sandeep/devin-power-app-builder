import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `import "server-only"` throws outside a React server bundle; tests run platform code directly.
      "server-only": path.resolve(__dirname, "tests/empty.ts"),
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
