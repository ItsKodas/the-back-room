import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // games/ included explicitly: a workspace that is not listed here has its
    // tests silently skipped rather than failing, which is the worst way for a
    // suite to be wrong.
    include: [
      "packages/**/*.test.{ts,tsx}",
      "games/**/*.test.{ts,tsx}",
      "apps/**/*.test.{ts,tsx}",
    ],
  },
});
