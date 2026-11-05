import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { SHARED_METHOD_TOOLS } from "./src/default-methods";

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: {
      bindings: { ECCAL_ORIGIN: "" },
      workers: [{
        name: "thinkwithblack-mcp", modules: true, compatibilityDate: "2026-11-04",
        script: `import { WorkerEntrypoint } from 'cloudflare:workers';
          export class CallMethods extends WorkerEntrypoint {
            list() { return ${JSON.stringify(SHARED_METHOD_TOOLS)}.map(name => ({ name, description: 'controlled fixture', parameters: { type: 'object', properties: {}, additionalProperties: false } })); }
            call() { return { content: [{ type: 'text', text: 'controlled shared method fixture' }] }; }
          }
          export default { fetch() { return new Response(null, { status: 503 }); } };`,
      }],
    },
  })],
  test: { include: ["test/**/*.test.ts"], testTimeout: 15000 },
});
