import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const result = await build({ stdin: { contents: 'export { consultation } from "./test/fixtures/handoff-consultation"; export { handoff } from "./src/delivery";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "node", format: "esm" });
const { consultation, handoff } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const output = { caseType: "synthetic", sourceRecord: consultation, handoff: handoff(consultation) };
await mkdir(resolve("docs/examples"), { recursive: true });
await writeFile(resolve("docs/examples/handoff-consultation.json"), `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write("docs/examples/handoff-consultation.json\n");
