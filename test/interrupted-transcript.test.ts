import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { MemberEngine } from "../src/member-engine";
import { MemberRoom, type Env } from "../src/worker";
import type { CallRecord, Store } from "../src/contracts";
import { fixture } from "./fixture";
import { AssistantPlayback } from "../src/assistant-playback";

describe("M2-01 插話後保存已播放的助理片段", () => {
  it.each(["retrieval-timeout", "asr-failed", "asr-completed"])("%s：掛斷與計費不等待片段整理", async scenario => {
    const f = fixture(); const call = await f.start();
    await f.engine.ingest("a", call.id, { type: "output_audio_buffer.started", event_id: "fixture-start" });
    f.advance(1250); const stopAt = f.now();
    const tasks: Promise<unknown>[] = []; const pair = new WebSocketPair(); pair[0].accept(); pair[1].accept();
    const room = Object.assign(Object.create(MemberRoom.prototype), {
      engine: f.engine, queue: Promise.resolve(), assistantPlayback: new Map(),
      env: { CUTOFFS: { idFromName: (id: string) => id, get: () => ({ cancel: async () => {} }) } }, finish: vi.fn(),
    });
    const playback = new AssistantPlayback(pair[0], async () => { if (scenario === "asr-failed") throw new Error("fixture"); return "已播放片段"; }, {
      begin: async id => { await room.run(() => f.engine.beginAssistantTranscript("a", call.id, id)); },
      complete: async (id, text, at) => { await room.run(() => f.engine.finishAssistantTranscript("a", call.id, id, text, at)); },
      fail: async id => { await room.run(() => f.engine.finishAssistantTranscript("a", call.id, id, null, f.now())); },
      changed: async () => {}, waitUntil: task => { tasks.push(task); },
    });
    room.assistantPlayback.set(call.id, playback);
    playback.observe({ type: "response.output_item.added", response_id: "fixture-response", item: { id: "assistant-part", role: "assistant" } });
    playback.observe({ type: "output_audio_buffer.started", response_id: "fixture-response" });
    try {
      const stopped = await Promise.race([room.stop("a", call.id), new Promise((_, reject) => setTimeout(() => reject(new Error("STOP_WAITED_FOR_RETRIEVAL")), 500))]);
      expect(stopped).toMatchObject({ ok: true, value: { status: "ended", settlement: { billedSeconds: 2, remainingSeconds: 298 } } });
      expect((await f.record(call.id))?.endedAt).toBe(stopAt);
      f.advance(5000);
      if (scenario === "retrieval-timeout") await new Promise(resolve => setTimeout(resolve, 5100));
      else {
        playback.observe({ type: "conversation.item.truncated", item_id: "assistant-part", content_index: 0, audio_end_ms: 500 });
        playback.observe({ type: "conversation.item.retrieved", item: { id: "assistant-part", role: "assistant", content: [{ type: "output_audio", audio: btoa("\0".repeat(24000)), transcript: "未播放的全文" }] } });
      }
      await Promise.allSettled(tasks);
      const record = (await f.record(call.id))!;
      expect(record.endedAt).toBe(stopAt);
      expect(record.settlement).toEqual({ billedSeconds: 2, remainingSeconds: 298 });
      expect(f.eccal.settle).toHaveBeenCalledTimes(1);
      expect(record.transcript.map(line => line.text)).toEqual(scenario === "asr-completed" ? ["已播放片段"] : []);
      expect(record.transcriptionFailures).toEqual(scenario === "asr-completed" ? [] : ["assistant-part"]);
    } finally { playback.close(); pair[0].close(); pair[1].close(); }
  });
  it("錯誤會員不能透過結束請求清除他人的音訊", async () => {
    const f = fixture(); const call = await f.start(); const prepareEnd = vi.fn(async () => {});
    const room = {
      engine: f.engine, assistantPlayback: new Map([[call.id, { prepareEnd }]]),
      async run(action: () => Promise<unknown>) { try { return { ok: true, value: await action() }; } catch (error) { return { ok: false, status: (error as { status: number }).status }; } },
    };
    expect(await MemberRoom.prototype.stop.call(room as unknown as MemberRoom, "b", call.id)).toMatchObject({ ok: false, status: 404 });
    expect(prepareEnd).not.toHaveBeenCalled();
    expect(f.realtime.hangup).not.toHaveBeenCalled();
  });
  it.each([
    { label: "正常前綴與重送截斷", endMs: 500, audioBytes: 24000, asrFails: false, prefix: true, failure: false },
    { label: "未播放音訊", endMs: 0, audioBytes: 0, asrFails: false, prefix: false, failure: false },
    { label: "取回全文仍依可信截斷點裁切", endMs: 500, audioBytes: 24048, asrFails: false, prefix: true, failure: false },
    { label: "取回音訊不足已播放長度", endMs: 500, audioBytes: 23952, asrFails: false, prefix: false, failure: true },
    { label: "轉寫失敗", endMs: 500, audioBytes: 24000, asrFails: true, prefix: false, failure: true },
  ])("$label：晚到全文與 stopped 不會保存未播放結尾", async scenario => {
    const runtime = env as unknown as Env;
    const stub = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, async (_instance, state) => {
      const f = fixture(); const call = await f.start();
      await f.engine.ingest("a", call.id, { type: "output_audio_buffer.started", event_id: "fixture-audio" });
      await f.engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "user-1", transcript: "請先說明診斷順序" });
      await state.storage.put(`call:${call.id}`, await f.record(call.id));
      const store: Store = {
        get: key => state.storage.get(key), put: (key, value) => state.storage.put(key, value),
        delete: async key => { await state.storage.delete(key); }, list: prefix => state.storage.list({ prefix }), alarm: at => state.storage.setAlarm(at),
      };
      const tasks: Promise<unknown>[] = [];
      const room = Object.assign(Object.create(MemberRoom.prototype), {
        env: { OPENAI_API_KEY: "fixture-key" }, engine: new MemberEngine({ ...f.deps, store }), queue: Promise.resolve(),
        sockets: new Map(), pendingSpeech: new Map(), drains: new Map(),
        ctx: { storage: state.storage, waitUntil(task: Promise<unknown>) { tasks.push(task.catch(() => {})); } },
        stop: vi.fn(async () => {}),
      });
      let provider: WebSocket | undefined, transcriptionCount = 0, transcribedChars = 0;
      const audio = btoa("\0".repeat(scenario.audioBytes));
      const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
        const url = String(input); const pair = new WebSocketPair(); pair[1].accept();
        if (url.includes("call_id=")) {
          provider = pair[1];
          provider.addEventListener("message", event => {
            const request = JSON.parse(String(event.data));
            if (request.type === "conversation.item.retrieve") provider!.send(JSON.stringify({ type: "conversation.item.retrieved", item: { id: "assistant-1", type: "message", role: "assistant", content: [{ type: "output_audio", audio, transcript: "已播放的開頭，未播放的結尾" }] } }));
          });
        } else {
          expect(url).toBe("https://api.openai.com/v1/realtime?intent=transcription"); transcriptionCount++;
          pair[1].addEventListener("message", event => {
            const request = JSON.parse(String(event.data));
            if (request.type === "session.update") pair[1].send(JSON.stringify({ type: "session.updated" }));
            if (request.type === "input_audio_buffer.append") transcribedChars += request.audio.length;
            if (request.type === "input_audio_buffer.commit") pair[1].send(JSON.stringify(scenario.asrFails ? { type: "error" } : { type: "conversation.item.input_audio_transcription.completed", item_id: "asr-only-item", transcript: "已播放的開頭" }));
          });
        }
        return new Response(null, { status: 101, webSocket: pair[0] });
      });
      try {
        await room.attach("a", call.id, "rtc_fixture");
        for (const event of [
          { type: "conversation.item.added", item: { id: "user-1" }, previous_item_id: null },
          { type: "response.output_item.added", response_id: "response-1", item: { id: "assistant-1", role: "assistant" } },
          { type: "conversation.item.added", item: { id: "assistant-1" }, previous_item_id: "user-1" },
          { type: "response.output_audio_transcript.done", response_id: "response-1", item_id: "assistant-1", transcript: "已播放的開頭，未播放的結尾" },
          { type: "output_audio_buffer.cleared", response_id: "response-1" },
          { type: "conversation.item.truncated", item_id: "assistant-1", content_index: 0, audio_end_ms: scenario.endMs },
          { type: "conversation.item.truncated", item_id: "assistant-1", content_index: 0, audio_end_ms: scenario.endMs },
          { type: "response.output_audio_transcript.done", response_id: "response-1", item_id: "assistant-1", transcript: "已播放的開頭，未播放的結尾" },
          { type: "conversation.item.input_audio_transcription.completed", item_id: "user-2", transcript: "先停一下，請只說第一步" },
          { type: "conversation.item.added", item: { id: "user-2" }, previous_item_id: "assistant-1" },
          { type: "output_audio_buffer.stopped", response_id: "response-1" },
        ]) provider!.send(JSON.stringify(event));
        let record: CallRecord | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
          record = await state.storage.get<CallRecord>(`call:${call.id}`);
          if (record?.transcript.some(line => line.itemId === "user-2") && !record.pendingTranscripts.length && (scenario.prefix ? record.transcript.some(line => line.itemId === "assistant-1") : scenario.failure ? record.transcriptionFailures.includes("assistant-1") : true)) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(record!.transcript.map(line => [line.role, line.text])).toEqual([
          ["user", "請先說明診斷順序"], ...(scenario.prefix ? [["assistant", "已播放的開頭"]] : []), ["user", "先停一下，請只說第一步"],
        ]);
        expect(record!.transcript.find(line => line.itemId === "assistant-1")?.interrupted).toBe(scenario.prefix ? true : undefined);
        expect(record!.pendingTranscripts).toEqual([]);
        expect(record!.transcriptionFailures).toEqual(scenario.failure ? ["assistant-1"] : []);
        expect(transcriptionCount).toBe(scenario.prefix || scenario.asrFails ? 1 : 0);
        expect(transcribedChars).toBe(scenario.prefix || scenario.asrFails ? scenario.endMs * 64 : 0);
        await expect(room.engine.get("b", call.id)).rejects.toMatchObject({ status: 404 });
        if (audio) expect(JSON.stringify([...await state.storage.list()])).not.toContain(audio);
      } finally {
        provider?.close(1000, "fixture complete"); fetcher.mockRestore();
        await Promise.allSettled(tasks); await state.storage.deleteAll(); await state.storage.deleteAlarm();
      }
    });
  });
});
