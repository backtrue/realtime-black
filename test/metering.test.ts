import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { billedSeconds, callDeadline, TOOL_WAIT_LIMIT_MS } from "../src/metering";
import type { MeterEvent } from "../src/contracts";
import type { Env } from "../src/worker";
import { fixture } from "./fixture";

afterEach(() => vi.restoreAllMocks());
const event = (type: MeterEvent["type"], at: number, toolCallId?: string): MeterEvent => ({ id: `${type}:${at}:${toolCallId ?? ""}`, type, at, ...(toolCallId ? { toolCallId } : {}) });

describe("D2 核定扣秒時間軸", () => {
  it.each([
    { name: "未接通", events: [event("reserved", 0), event("ended", 5000)], expected: 0 },
    { name: "90 秒對話加 30 秒工具等待", events: [event("connected", 0), event("tool_started", 30000, "t1"), event("tool_finished", 60000, "t1"), event("ended", 120000)], expected: 90 },
    { name: "多段時間合計後才向上取整", events: [event("connected", 0), event("tool_started", 400, "t1"), event("tool_finished", 1000, "t1"), event("ended", 1400)], expected: 1 },
    { name: "斷線計至確認掛斷", events: [event("connected", 1000), event("disconnected", 5100), event("ended", 7100)], expected: 7 },
    { name: "掛斷時工具尚未回覆", events: [event("connected", 0), event("tool_started", 1500, "t1"), event("ended", 9000)], expected: 2 },
    { name: "重疊工具等待只扣除一次", events: [event("connected", 0), event("tool_started", 1000, "t1"), event("tool_started", 2000, "t2"), event("tool_finished", 4000, "t1"), event("tool_finished", 5000, "t2"), event("ended", 10000)], expected: 6 },
    { name: "連線前等待不影響已接通用量", events: [event("tool_started", 0, "t1"), event("tool_finished", 5000, "t1"), event("connected", 6000), event("ended", 7500)], expected: 2 },
  ])("$name", ({ events, expected }) => { expect(billedSeconds(events, 300)).toBe(expected); });

  it("超出占用的用量以占用秒數為上限", () => {
    expect(billedSeconds([event("connected", 0), event("ended", 9000)], 1)).toBe(1);
  });
  it("同一結束事件重送不重複計算", () => {
    const ended = event("ended", 1500);
    expect(billedSeconds([event("connected", 0), ended, ended], 300)).toBe(2);
  });
  it("第一段音訊才開始可用秒數倒數，工具等待後延長截止", () => {
    const reservation = { id: "r", memberId: "a", seconds: 10, deadline: 10000 };
    const events = [event("connected", 5000), event("tool_started", 6000, "t1")];
    expect(callDeadline({ reservation, events }, 7000)).toBe(6000 + TOOL_WAIT_LIMIT_MS + 9000);
    events.push(event("tool_finished", 10000, "t1"));
    expect(callDeadline({ reservation, events }, 10000)).toBe(19000);
  });

  it("實際工具等待不扣秒且兩通共用結算後的餘額", async () => {
    const f = fixture(); const first = await f.start();
    f.advance(5000); await f.engine.ingest("a", first.id, { type: "input_audio_buffer.speech_started" });
    f.advance(1000); f.mcp.call.mockImplementationOnce(async () => { f.advance(5000); return { method: "fixture", evidence: "fixture-source" }; });
    await f.engine.tool("a", first.id, "t1", "read_method", "{}");
    f.advance(500); await f.engine.end("a", first.id);
    expect((await f.record(first.id))?.settlement).toEqual({ billedSeconds: 2, remainingSeconds: 298 });
    const second = await f.start(); await f.engine.ingest("a", second.id, { type: "output_audio_buffer.started" });
    f.advance(298000); await f.engine.alarm();
    expect((await f.record(second.id))?.settlement).toEqual({ billedSeconds: 298, remainingSeconds: 0 });
    expect(f.balances.get("b")).toBe(300);
  });
  it("工具等待跨過原占用截止後仍保留未使用的通話秒數", async () => {
    const f = fixture(); f.balances.set("a", 1); const call = await f.start();
    await f.engine.ingest("a", call.id, { type: "input_audio_buffer.speech_started" });
    f.advance(500); f.mcp.call.mockImplementationOnce(async () => { f.advance(5000); return { method: "fixture", evidence: "fixture-source" }; });
    await f.engine.tool("a", call.id, "t1", "read_method", "{}");
    await f.engine.alarm(); expect(f.realtime.hangup).not.toHaveBeenCalled();
    f.advance(500); await f.engine.alarm();
    expect((await f.record(call.id))?.settlement).toEqual({ billedSeconds: 1, remainingSeconds: 0 });
  });
  it("20 秒工具逾時後恢復剩餘秒數，原 alarm 不先掛斷整通", async () => {
    const f = fixture(); const call = await f.start();
    await f.engine.ingest("a", call.id, { type: "input_audio_buffer.speech_started" });
    f.advance(1000);
    f.mcp.call.mockImplementationOnce(async () => {
      f.advance(TOOL_WAIT_LIMIT_MS);
      await f.engine.alarm();
      expect(f.realtime.hangup).not.toHaveBeenCalled();
      throw new Error("fixture-tool-timeout");
    });
    await f.engine.tool("a", call.id, "t1", "read_method", "{}");
    f.advance(1000); await f.engine.end("a", call.id);
    expect((await f.record(call.id))?.settlement).toEqual({ billedSeconds: 2, remainingSeconds: 298 });
  });
  it("ECCAL 回傳不符已核定規則的用量時保留待對帳工作", async () => {
    const f = fixture(); const call = await f.start();
    vi.mocked(f.eccal.settle).mockResolvedValueOnce({ billedSeconds: 1, remainingSeconds: 299 });
    await expect(f.engine.end("a", call.id)).rejects.toMatchObject({ code: "SETTLEMENT_INVALID" });
    expect(await f.store.get(`settlement:${call.id}`)).toBeDefined();
    expect((await f.record(call.id))?.settlement).toBeUndefined();
  });
});

describe("CallCutoff 截止更新", () => {
  it("舊 alarm 先抵達時直接核對已落盤的新計時，不等待會員工作佇列", async () => {
    const runtime = env as unknown as Env;
    const f = fixture(); const call = await f.start();
    await f.engine.ingest("a", call.id, { type: "input_audio_buffer.speech_started" });
    const record = (await f.record(call.id))!;
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("a")))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const member = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(digest));
    const cutoff = runtime.CUTOFFS.get(runtime.CUTOFFS.idFromName(crypto.randomUUID()));
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      await runInDurableObject(member, async (_instance, state) => { await state.storage.put(`call:${call.id}`, record); });
      await cutoff.arm({ memberId: "a", recordId: call.id, callId: "rtc_fixture", deadline: Date.now() - 1, meterRevision: 1 });
      await runDurableObjectAlarm(cutoff);
      expect(fetcher).not.toHaveBeenCalled();
      await runInDurableObject(cutoff, async (_instance, state) => {
        const stored = await state.storage.get<{ deadline: number; meterRevision: number }>("call");
        expect(stored?.meterRevision).toBe(2); expect(stored?.deadline).toBeGreaterThan(Date.now());
      });
    } finally {
      await cutoff.cancel();
      await runInDurableObject(member, async (_instance, state) => { await state.storage.deleteAll(); await state.storage.deleteAlarm(); });
    }
  });
  it("延長後舊 alarm 不提前掛斷，舊版本也不能蓋掉新截止", async () => {
    const runtime = env as unknown as Env;
    const stub = runtime.CUTOFFS.get(runtime.CUTOFFS.idFromName(crypto.randomUUID()));
    const fetcher = vi.spyOn(globalThis, "fetch");
    const deadline = Date.now() + 60000;
    try {
      await stub.arm({ memberId: "a", recordId: "fixture", callId: "rtc_fixture", deadline: Date.now() - 1 });
      await stub.updateDeadline(deadline, 3);
      await stub.updateDeadline(Date.now() - 1, 2);
      await runDurableObjectAlarm(stub);
      expect(fetcher).not.toHaveBeenCalled();
      await runInDurableObject(stub, async (_instance, state) => { expect(await state.storage.getAlarm()).toBe(deadline); });
    } finally { await stub.cancel(); }
    expect(await stub.updateDeadline(deadline, 4)).toEqual({ ok: false, error: "CALL_ENDED", status: 409 });
  });
});
