import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { MemberEngine } from "../src/member-engine";
import type { CallRecord, Store } from "../src/contracts";
import type { Env } from "../src/worker";
import { fixture } from "./fixture";

const day = 86400000;

describe("M2-03 兩筆紀錄的 30 天保存驗收", () => {
  it.each(["list", "direct", "alarm"] as const)("%s 先觸發到期檢查，SQLite 只刪除到期正文與摘要", async path => {
    const runtime = env as unknown as Env;
    const stub = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, async (_instance, state) => {
      const f = fixture();
      const store: Store = {
        get: key => state.storage.get(key),
        put: (key, value) => state.storage.put(key, value),
        delete: async key => { await state.storage.delete(key); },
        list: prefix => state.storage.list({ prefix }),
        alarm: at => state.storage.setAlarm(at),
      };
      const engine = new MemberEngine({ ...f.deps, store });
      const create = async (label: string) => {
        const call = await engine.start({ memberId: "a", eligible: true }, crypto.randomUUID(), "v=0\r\nfixture");
        await engine.activate("a", call.id);
        await engine.ingest("a", call.id, { type: "output_audio_buffer.started", event_id: `${label}-audio` });
        await engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: `${label}-user`, transcript: `${label}-retention-body` });
        f.advance(1000);
        await engine.end("a", call.id);
        const summary = await engine.document("a", call.id, "summary");
        const record = await engine.get("a", call.id);
        expect(summary.findings[0]?.sourceIds).toEqual([`${label}-user`]);
        expect(record.status).toBe("ended");
        expect(record.expiresAt).toBe(record.endedAt! + 30 * day);
        return record;
      };
      try {
        const older = await create("older");
        f.advance(day);
        const newer = await create("newer");
        const expiredAt = older.expiresAt!;
        f.advance(expiredAt - 1 - f.now());
        expect(f.now()).toBe(expiredAt - 1);
        expect((await engine.list("a")).map(r => r.id)).toEqual([newer.id, older.id]);
        expect((await engine.get("a", older.id)).documents).toHaveLength(1);
        expect((await engine.get("a", newer.id)).documents).toHaveLength(1);
        const before = await state.storage.list<CallRecord>({ prefix: "call:" });
        expect(before.size).toBe(2);
        expect(before.get(`call:${older.id}`)?.transcript[0]?.text).toBe("older-retention-body");

        f.advance(1);
        expect(f.now()).toBe(expiredAt);
        const physicalBeforeCleanup = await state.storage.list<CallRecord>({ prefix: "call:" });
        expect(physicalBeforeCleanup.size).toBe(2);
        if (path === "list") expect((await engine.list("a")).map(r => r.id)).toEqual([newer.id]);
        else if (path === "direct") await expect(engine.get("a", older.id)).rejects.toMatchObject({ code: "RECORD_NOT_FOUND", status: 404 });
        else await engine.alarm();

        const physicalAfterCleanup = await state.storage.list<CallRecord>({ prefix: "call:" });
        const allStoredAfterCleanup = JSON.stringify([...await state.storage.list()]);
        expect([...physicalAfterCleanup.keys()]).toEqual([`call:${newer.id}`]);
        expect(allStoredAfterCleanup).not.toContain("older-retention-body");
        expect(allStoredAfterCleanup).not.toContain(older.documents[0]!.id);
        expect(physicalAfterCleanup.get(`call:${newer.id}`)).toEqual(newer);
        await expect(engine.get("a", older.id)).rejects.toMatchObject({ code: "RECORD_NOT_FOUND", status: 404 });
        expect((await engine.list("a")).map(r => r.id)).toEqual([newer.id]);
        expect(await engine.get("a", newer.id)).toEqual(newer);
        await expect(engine.get("b", newer.id)).rejects.toMatchObject({ status: 404 });
        if (path === "alarm") expect(await state.storage.getAlarm()).toBe(newer.expiresAt);

        console.log("RETENTION_ACCEPTANCE " + JSON.stringify({
          path, storage: "Cloudflare Workers SQLite runtime", externalServices: "controlled fixtures",
          older: { createdAt: older.createdAt, endedAt: older.endedAt, expiresAt: older.expiresAt },
          newer: { createdAt: newer.createdAt, endedAt: newer.endedAt, expiresAt: newer.expiresAt },
          before: { at: expiredAt - 1, listCount: 2, olderReadable: true, newerReadable: true, storedCount: before.size },
          after: { at: expiredAt, listCount: 1, olderDirectStatus: 404, newerReadable: true, physicalBeforeCount: physicalBeforeCleanup.size, physicalAfterCount: physicalAfterCleanup.size, expiredBodyAbsent: true, expiredSummaryAbsent: true, allStorageRowsChecked: true, newerUnchanged: true, nextAlarmAt: await state.storage.getAlarm() },
        }));
      } finally {
        await state.storage.deleteAll();
        await state.storage.deleteAlarm();
      }
    });
  });
});
