import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "json-summary", "lcov"],
      reportsDirectory: "./coverage",
      all: true,
      include: ["lib/**/*.{ts,tsx}", "app/api/**/*.ts"],
      exclude: [
        "tests/**",
        "**/*.test.ts",
        "lib/prisma.ts",
        "lib/guard-session.types.ts",
        "lib/plagiarism/types.ts",
        "**/node_modules/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
