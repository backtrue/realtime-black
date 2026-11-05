import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import worker, { type Env } from "../src/worker";
import { MemberEngine } from "../src/member-engine";
import { hash } from "../src/auth-crypto";
import type { CallRecord, DeliveryJob, DeliveryPort, Store } from "../src/contracts";
import { fixture } from "./fixture";

const sqliteStore = (state: DurableObjectState): Store => ({ get: key => state.storage.get(key), put: (key, value) => state.storage.put(key, value), delete: async key => { await state.storage.delete(key); }, list: prefix => state.storage.list({ prefix }), alarm: at => state.storage.setAlarm(at) });

describe("M2-08 交付狀態與持久證據", () => {
  it("兩個通路的待處理、拒絕、不明與確認送出皆經 SQLite 重建及 HTTP 核對", async () => {
    const runtime = env as unknown as Env;
    const stub = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(await hash("a")));
    const f = fixture();
    f.eccal.emailRecipient = vi.fn(async () => 'controlled@example.invalid');
    f.eccal.authenticate = vi.fn(async credentials => credentials.cookie === "fixture=a" ? { memberId: "a", eligible: true } : credentials.cookie === "fixture=b" ? { memberId: "b", eligible: true } : null);
    const rows = [];
    const cases = [
      { scenario: "not-sent", expected: "pending" },
      { scenario: "rejected", expected: "failed" },
      { scenario: "unknown", expected: "unknown" },
      { scenario: "confirmed", expected: "succeeded" },
    ] as const;
    const config = { ...runtime, APP_ORIGIN: "https://fixture.invalid", ECCAL: f.eccal };
    try {
      for (const channel of ["email", "line"] as const) {
        for (const { scenario, expected } of cases) {
          const receipt = `controlled-${channel}-${scenario}-receipt`;
          const sent: Array<{ documentId: string; channel: string; url: string }> = [];
          const delivery: DeliveryPort = {
            verify: async job => ({ memberId: job.memberId, jobId: job.id, documentId: job.documentId, recipient: channel === "email" ? job.recipient : "controlled-chatroom", verifiedAt: f.now(), supervised: true }),
            send: async (job, url) => {
              sent.push({ documentId: job.documentId, channel: job.channel, url });
              return scenario === "confirmed" ? { outcome: "sent", receipt } : { outcome: scenario === "rejected" ? "rejected" : "unknown" };
            },
          };
          const prepared = await runInDurableObject(stub, async (instance, state) => {
            const store = sqliteStore(state);
            const deps = { ...f.deps, store, delivery, appOrigin: config.APP_ORIGIN };
            const engine = new MemberEngine(deps);
            const call = await engine.start({ memberId: "a", eligible: true }, crypto.randomUUID(), "v=0\r\ncontrolled-offer");
            await engine.activate("a", call.id);
            await engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "controlled-input", transcript: "合成交付狀態測試" });
            await engine.end("a", call.id);
            const document = await engine.document("a", call.id, "report");
            (instance as unknown as { engine: MemberEngine }).engine = engine;
            return { callId: call.id, documentId: document.id };
          });
          const url = `https://fixture.invalid/api/calls/${prepared.callId}`;
          const request = (target: string, init: RequestInit = {}, cookie = "fixture=a") => worker.fetch(new Request(target, { ...init, headers: { origin: config.APP_ORIGIN, cookie, ...Object.fromEntries(new Headers(init.headers)) } }), config);
          const input = { documentId: prepared.documentId, channel, recipient: channel === "email" ? "controlled@example.invalid" : "", operationId: crypto.randomUUID() };
          const createdResponse = await request(`${url}/deliveries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
          expect(createdResponse.status).toBe(201);
          const created = await createdResponse.json() as { job: DeliveryJob; claimCode?: string };
          expect(created.job.state).toBe("pending"); expect(sent).toHaveLength(0);
          const replay = await request(`${url}/deliveries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
          expect((await replay.json() as { job: DeliveryJob }).job.id).toBe(created.job.id);
          if (scenario !== "not-sent") {
            const dispatched = await stub.dispatchDelivery("a", prepared.callId, created.job.id, { controlledProof: true }, created.claimCode);
            expect(dispatched.ok).toBe(true);
          }
          await runInDurableObject(stub, async (instance, state) => {
            const stored = await state.storage.get<CallRecord>(`call:${prepared.callId}`);
            expect(stored?.deliveries).toHaveLength(1);
            expect(stored?.deliveries[0]?.state).toBe(expected);
            expect(stored?.deliveries[0]?.documentId).toBe(prepared.documentId);
            expect(stored?.deliveries[0]?.channel).toBe(channel);
            expect(stored?.deliveries[0]?.providerReceipt).toBe(scenario === "confirmed" ? receipt : undefined);
            (instance as unknown as { engine: MemberEngine }).engine = new MemberEngine({ ...f.deps, store: sqliteStore(state), delivery, appOrigin: config.APP_ORIGIN });
          });
          const read = await request(url); expect(read.status).toBe(200); expect(read.headers.get("cache-control")).toBe("no-store");
          const publicRecord = await read.json() as { deliveries: Array<{ id: string; state: string; providerReceipt?: string; documentId: string; channel: string }> };
          const actual = publicRecord.deliveries.find(job => job.id === created.job.id)!;
          expect(actual.state).toBe(expected); expect(actual.documentId).toBe(prepared.documentId); expect(actual.channel).toBe(channel);
          expect(sent).toHaveLength(scenario === "not-sent" ? 0 : 1);
          if (sent.length) expect(sent[0]).toEqual({ documentId: prepared.documentId, channel, url: `https://fixture.invalid/#call=${prepared.callId}&document=${prepared.documentId}` });
          const other = await request(url, {}, "fixture=b"), anonymous = await request(url, {}, "");
          expect(other.status).toBe(404); expect(anonymous.status).toBe(401);
          rows.push({ channel, scenario, state: actual.state, sqliteReload: true, ownerStatus: read.status, otherMemberStatus: other.status, anonymousStatus: anonymous.status, providerAttempts: sent.length, correctDocumentAndChannel: true, receiptStored: scenario === "confirmed", receipt: scenario === "confirmed" ? receipt : null });
        }
      }
      const result = { environment: "Native Workers SQLite and actual HTTP/RPC routes; controlled identity, document and delivery providers", productionMemberUsed: false, externalMessageSent: false, results: rows };
      await expect(JSON.stringify(result, null, 2) + "\n").toMatchFileSnapshot("../docs/examples/delivery-state-validation-2026-11-05.json");
    } finally {
      await runInDurableObject(stub, async (_instance, state) => { await state.storage.deleteAll(); await state.storage.deleteAlarm(); });
      vi.restoreAllMocks();
    }
  });
});
