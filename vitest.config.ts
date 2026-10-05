import path from "node:path";
import { defineConfig } from "vitest/config";

// Los tests corren contra un Postgres en memoria (PGlite) al que se le
// aplican las MISMAS migraciones de drizzle/ — nunca contra la base real.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
