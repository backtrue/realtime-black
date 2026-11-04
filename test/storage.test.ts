import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { MemberEngine } from "../src/member-engine";
import type { CallRecord, Store } from "../src/contracts";
import type { Env } from "../src/worker";
import { fixture } from "./fixture";

describe("M2-12 通話資料儲存抽查", () => {
  it("SQLite 內正文與衍生資料集中於會員通話，30 天到期一併清除", async () => {
    const runtime = env as unknown as Env;
    const stub = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, async (_instance, state) => {
      const f = fixture();
      const writes: Array<[string, unknown]> = [];
      const store: Store = {
        get: key => state.storage.get(key),
        put: async (key, value) => { writes.push([key, structuredClone(value)]); await state.storage.put(key, value); },
        delete: async key => { await state.storage.delete(key); },
        list: prefix => state.storage.list({ prefix }),
        alarm: at => state.storage.setAlarm(at),
      };
      const engine = new MemberEngine({ ...f.deps, store });
      try {
        const call = await engine.start({ memberId: "a", eligible: true }, crypto.randomUUID(), "v=0\r\nfixture-private-sdp");
        await engine.activate("a", call.id);
        await engine.ingest("a", call.id, {
          type: "conversation.item.input_audio_transcription.completed", item_id: "fixture-u1", transcript: "fixture-private-consultation",
          audio: "fixture-private-raw-audio", accessToken: "fixture-private-event-token",
        });
        await engine.tool("a", call.id, "fixture-tool-1", "read_method", "{}");
        await engine.end("a", call.id);
        for (const kind of ["summary", "report", "copy", "plan"] as const) await engine.document("a", call.id, kind);
        const record = await engine.get("a", call.id);
        const report = record.documents.find(document => document.kind === "report")!;
        await engine.requestDelivery("a", call.id, { documentId: report.id, channel: "email", recipient: "fixture-private-recipient@example.invalid", operationId: crypto.randomUUID() });
        const line = await engine.requestDelivery("a", call.id, { documentId: report.id, channel: "line", recipient: "", operationId: crypto.randomUUID() });

        const rows = await state.storage.list();
        const stored = rows.get(`call:${call.id}`) as CallRecord;
        expect(stored.memberId).toBe("a");
        expect(stored.documents.map(document => document.kind)).toEqual(["summary", "report", "copy", "plan"]);
        expect(stored.tools).toHaveLength(1);
        expect(stored.deliveries).toHaveLength(2);
        expect(stored.expiresAt).toBe(stored.endedAt! + 30 * 86400000);
        expect([...rows.keys()].filter(key => JSON.stringify(rows.get(key)).includes("fixture-private-consultation"))).toEqual([`call:${call.id}`]);
        const persisted = JSON.stringify(writes);
        for (const absent of ["fixture-private-sdp", "fixture-private-raw-audio", "fixture-private-event-token", "fixture-token-a", line.claimCode!]) expect(persisted).not.toContain(absent);
        await expect(engine.get("b", call.id)).rejects.toMatchObject({ status: 404 });

        f.advance(30 * 86400000 - 1);
        expect((await engine.get("a", call.id)).documents).toHaveLength(4);
        f.advance(1);
        await engine.alarm();
        expect(await engine.list("a")).toEqual([]);
        await expect(engine.get("a", call.id)).rejects.toMatchObject({ status: 404 });
        const expired = await state.storage.list();
        expect(expired.has(`call:${call.id}`)).toBe(false);
        const remaining = JSON.stringify([...expired]);
        for (const absent of ["fixture-private-consultation", "fixture-private-recipient", "fixture-only", line.job.claimDigest!]) expect(remaining).not.toContain(absent);
        expect([...expired.keys()].every(key => key.startsWith("operation:"))).toBe(true);
      } finally {
        await state.storage.deleteAll();
        await state.storage.deleteAlarm();
      }
    });
  });
});
