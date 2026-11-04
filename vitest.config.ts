import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: { bindings: { ECCAL_ORIGIN: "" } },
  })],
  test: { include: ["test/**/*.test.ts"], testTimeout: 15000 },
});
