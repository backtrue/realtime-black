import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { fixture, failure } from "./fixture";
import worker, { type Env } from "../src/worker";
import { handoff, redeemClaim, sendDelivery, type Delivery } from "../src/delivery";

afterEach(() => vi.restoreAllMocks());

describe("M0 會員與額度", () => {
  it("資格不足不建立 Realtime 連線", async () => {
    const f = fixture();
    await expect(f.engine.start({ memberId: "a", eligible: false }, crypto.randomUUID(), "v=0")).rejects.toMatchObject({ code: "MEMBER_INELIGIBLE" });
    expect(f.realtime.create).not.toHaveBeenCalled();
  });
  it("30 天由服務端確認通話結束起算", async () => {
    const f = fixture(); const call = await f.start(); const createdAt = f.now();
    f.advance(120000); await f.engine.end("a", call.id);
    expect((await f.record(call.id))?.expiresAt).toBe(createdAt + 120000 + 30 * 86400000);
  });
  it.each([0, -1, NaN, 1.5])("不以無效或零餘額 %s 發證", async seconds => {
    const f = fixture(); f.balances.set("a", seconds);
    await expect(f.start()).rejects.toMatchObject({ code: seconds === 0 ? "QUOTA_EXHAUSTED" : "BALANCE_INVALID" });
    expect(f.realtime.create).not.toHaveBeenCalled();
  });
  it("兩通 120、180 秒累計為 300、180、0，另一會員不變", async () => {
    const f = fixture();
    expect(await f.eccal.balance("a")).toBe(300);
    const first = await f.start();
    await f.engine.ingest("a", first.id, { type: "input_audio_buffer.speech_started", event_id: "connected-1" });
    f.advance(120000); await f.engine.end("a", first.id);
    expect(await f.eccal.balance("a")).toBe(180);
    const second = await f.start();
    await f.engine.ingest("a", second.id, { type: "input_audio_buffer.speech_started", event_id: "connected-2" });
    f.advance(180000); await f.engine.end("a", second.id);
    expect(await f.eccal.balance("a")).toBe(0);
    expect(await f.eccal.balance("b")).toBe(300);
    await expect(f.start()).rejects.toMatchObject({ code: "QUOTA_EXHAUSTED" });
  });
  it("相同操作不重發，已結束後重放仍拒絕", async () => {
    const f = fixture(); const operationId = crypto.randomUUID(); const call = await f.start("a", operationId);
    await f.engine.end("a", call.id);
    await expect(f.start("a", operationId)).rejects.toMatchObject({ code: "OPERATION_REPLAYED" });
    expect(f.realtime.create).toHaveBeenCalledTimes(1);
  });
  it("同一會員已有會話時拒絕另一通", async () => {
    const f = fixture(); await f.start();
    await expect(f.start()).rejects.toMatchObject({ code: "CALL_ALREADY_ACTIVE" });
    expect(f.realtime.create).toHaveBeenCalledTimes(1);
  });
  it("掛斷失敗不釋放額度，alarm 重試成功才結算", async () => {
    const f = fixture(); const call = await f.start();
    f.realtime.hangup.mockRejectedValueOnce(failure("REALTIME_HANGUP_FAILED"));
    await expect(f.engine.end("a", call.id)).rejects.toThrow();
    expect(f.eccal.settle).not.toHaveBeenCalled();
    await expect(f.start()).rejects.toMatchObject({ code: "CALL_ALREADY_ACTIVE" });
    await f.engine.alarm();
    expect((await f.record(call.id))?.status).toBe("ended");
    expect(f.eccal.settle).toHaveBeenCalledTimes(1);
  });
  it("結算失敗可重試，已確認的掛斷不重送", async () => {
    const f = fixture(); const call = await f.start();
    vi.mocked(f.eccal.settle).mockRejectedValueOnce(failure("ECCAL_UNAVAILABLE"));
    await expect(f.engine.end("a", call.id)).rejects.toThrow();
    await f.engine.alarm(); await f.engine.end("a", call.id);
    expect(f.realtime.hangup).toHaveBeenCalledTimes(1);
    expect((await f.record(call.id))?.settlement?.billedSeconds).toBe(0);
  });
  it("沒有前端倒數仍在額度截止後由後端掛斷", async () => {
    const f = fixture(); f.balances.set("a", 1); const call = await f.start();
    await f.engine.ingest("a", call.id, { type: "input_audio_buffer.speech_started" });
    f.advance(1000); await f.engine.alarm();
    expect(f.realtime.hangup).toHaveBeenCalledWith("rtc_fixture");
    expect((await f.record(call.id))?.settlement).toEqual({ billedSeconds: 1, remainingSeconds: 0 });
  });
  it("建立會話失敗釋放未使用額度，不補發新額度", async () => {
    const f = fixture(); f.realtime.create.mockRejectedValueOnce(failure("REALTIME_UNAVAILABLE"));
    await expect(f.start()).rejects.toThrow();
    expect(f.balances.get("a")).toBe(300);
    expect(f.realtime.hangup).not.toHaveBeenCalled();
    expect(f.eccal.settle).toHaveBeenCalledTimes(1);
  });
  it("提供者已確認結束後直接結算，不重送掛斷", async () => {
    const f = fixture(); const call = await f.start();
    await f.engine.providerEnded("a", call.id, f.now());
    expect(f.eccal.settle).not.toHaveBeenCalled();
    await f.engine.alarm();
    expect(f.realtime.hangup).not.toHaveBeenCalled();
    expect((await f.record(call.id))?.status).toBe("ended");
  });
  it("占用請求逾時保留原操作，alarm 以同一操作對帳後釋放", async () => {
    const f = fixture(); const original = f.eccal.reserve;
    const accepted = vi.mocked(f.eccal.reserve).getMockImplementation()!;
    let operation: string | undefined;
    vi.mocked(f.eccal.reserve).mockImplementationOnce(async (memberId, operationId) => {
      operation = operationId;
      // 受控模擬服務已接受請求，但呼叫端沒取得回應
      await accepted(memberId, operationId);
      throw new Error("fixture-timeout");
    });
    await expect(f.start()).rejects.toThrow();
    await expect(f.start()).rejects.toMatchObject({ code: "RESERVATION_PENDING" });
    await f.engine.alarm();
    expect(original).toHaveBeenNthCalledWith(2, "a", operation);
    expect(f.eccal.settle).toHaveBeenCalledTimes(1);
    expect(f.realtime.create).not.toHaveBeenCalled();
    expect(await f.store.get("pending-reservation")).toBeUndefined();
    expect(f.balances.get("a")).toBe(300);
  });
  it("建立會話前 isolate 中斷，alarm 立即釋放 starting 占用", async () => {
    const f = fixture(); const call = await f.start();
    const record = (await f.record(call.id))!; record.status = "starting"; delete record.callId;
    await f.store.put(`call:${call.id}`, record);
    expect(f.now()).toBeLessThan(record.reservation.deadline);
    await f.engine.alarm();
    expect((await f.record(call.id))?.status).toBe("failed");
    expect(f.eccal.settle).toHaveBeenCalledTimes(1);
    expect(f.realtime.hangup).not.toHaveBeenCalled();
    expect(await f.store.get("active")).toBeUndefined();
    expect(f.balances.get("a")).toBe(300);
  });
  it("等待外部建立會話時，保留近端 recovery alarm，不覆寫為300秒截止", async () => {
    const f = fixture();
    let finish!: (value: { callId: string; sdp: string }) => void;
    f.realtime.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const starting = f.engine.start({ memberId: "a", eligible: true }, crypto.randomUUID(), "v=0");
    await vi.waitFor(() => expect(f.realtime.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(f.store.alarm).mock.lastCall?.[0]).toBe(f.now() + 1000);
    finish({ callId: "rtc_fixture", sdp: "v=0" });
    const call = await starting;
    expect((await f.record(call.id))?.status).toBe("starting");
    expect(vi.mocked(f.store.alarm).mock.lastCall?.[0]).toBe(f.now() + 1000);
    await f.engine.alarm();
    expect((await f.record(call.id))?.status).toBe("ended");
    expect(f.balances.get("a")).toBe(300);
  });
});

describe("M1 會員工具授權與失敗", () => {
  it("拒絕取得另一會員的授權", async () => {
    const f = fixture(); vi.mocked(f.eccal.mcpGrant).mockResolvedValueOnce({ memberId: "b", accessToken: "fixture", expiresAt: f.now() + 10000, readOnlyTools: ["read_method"] });
    await expect(f.start()).rejects.toMatchObject({ code: "MCP_AUTH_INVALID" });
    expect(f.realtime.create).not.toHaveBeenCalled();
  });
  it("過期授權不能開始通話", async () => {
    const f = fixture(); vi.mocked(f.eccal.mcpGrant).mockResolvedValueOnce({ memberId: "a", accessToken: "fixture", expiresAt: f.now(), readOnlyTools: ["read_method"] });
    await expect(f.start()).rejects.toMatchObject({ code: "MCP_AUTH_INVALID" });
  });
  it("每次工具呼叫重查授權，撤銷後不讀資料", async () => {
    const f = fixture(); const call = await f.start(); vi.mocked(f.eccal.mcpGrant).mockRejectedValueOnce(failure("REVOKED"));
    const result = await f.engine.tool("a", call.id, "tool-1", "read_method", "{}");
    expect(JSON.parse(result.output).ok).toBe(false); expect(f.mcp.call).not.toHaveBeenCalled();
  });
  it("未授權的停廣告工具無法執行", async () => {
    const f = fixture(); const call = await f.start();
    const result = await f.engine.tool("a", call.id, "tool-1", "pause_ad", "{}");
    expect(JSON.parse(result.output).ok).toBe(false); expect(f.mcp.call).not.toHaveBeenCalled();
  });
  it("同一工具事件重播只呼叫一次，續答標記保留", async () => {
    const f = fixture(); const call = await f.start();
    const result = await f.engine.tool("a", call.id, "tool-1", "read_method", "{}");
    expect(JSON.parse(result.output).ok).toBe(true);
    await f.engine.toolSent("a", call.id, "tool-1");
    expect((await f.engine.tool("a", call.id, "tool-1", "read_method", "{}")).sent).toBe(true);
    expect(f.mcp.call).toHaveBeenCalledTimes(1);
  });
  it("工具失敗的紀錄不填造資料", async () => {
    const f = fixture(); const call = await f.start(); f.mcp.call.mockRejectedValueOnce(new Error("fixture-secret-should-not-return"));
    const result = await f.engine.tool("a", call.id, "tool-1", "read_method", "{}");
    expect(result.output).not.toContain("fixture-secret"); expect((await f.record(call.id))?.tools).toEqual([]);
  });
});

describe("M2 紀錄與成果", () => {
  it("跨會員不能讀取或產出別人的成果", async () => {
    const f = fixture(); const call = await f.start();
    await expect(f.engine.get("b", call.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.engine.document("b", call.id, "report")).rejects.toMatchObject({ status: 404 });
    expect(await f.engine.list("b")).toEqual([]);
  });
  it("重複逐字事件只保存一份，未確認播放的助理回答不寫入", async () => {
    const f = fixture(); const call = await f.start();
    const event = { type: "conversation.item.input_audio_transcription.completed", item_id: "user-1", transcript: "測試問題" };
    await f.engine.ingest("a", call.id, event); await f.engine.ingest("a", call.id, event);
    await f.engine.ingest("a", call.id, { type: "response.output_audio_transcript.done", item_id: "assistant-1", transcript: "還沒播放完的答覆" });
    expect((await f.record(call.id))?.transcript).toHaveLength(1);
  });
  it("語音辨識晚於 AI 播放完成，依 provider item 順序排列逐字稿", async () => {
    const f = fixture(); const call = await f.start();
    await f.engine.ingest("a", call.id, { type: "conversation.item.added", previous_item_id: "user-1", item: { id: "assistant-1", role: "assistant" } });
    await f.engine.assistantPlayed("a", call.id, { itemId: "assistant-1", role: "assistant", text: "已播放完的回答", at: f.now() });
    await f.engine.ingest("a", call.id, { type: "conversation.item.added", previous_item_id: null, item: { id: "user-1", role: "user" } });
    await f.engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "user-1", transcript: "較早說出的問題" });
    expect((await f.engine.get("a", call.id)).transcript.map(line => line.itemId)).toEqual(["user-1", "assistant-1"]);
  });
  it("最後一段語音仍在辨識時不生成摘要，結束後收到轉寫才解除", async () => {
    const f = fixture(); const call = await f.start();
    await f.engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "第一段" });
    await f.engine.ingest("a", call.id, { type: "input_audio_buffer.committed", item_id: "u2", previous_item_id: "u1" });
    await f.engine.end("a", call.id);
    await expect(f.engine.document("a", call.id, "summary")).rejects.toMatchObject({ code: "TRANSCRIPT_NOT_READY" });
    expect(f.documents.generate).not.toHaveBeenCalled();
    await f.engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "u2", transcript: "最後一段" });
    await f.engine.document("a", call.id, "summary");
    expect(vi.mocked(f.documents.generate).mock.lastCall?.[1].transcript.map(line => line.text)).toContain("最後一段");
  });
  it("舊摘要生成後晚到轉寫，清除舊摘要並依新逐字稿重建", async () => {
    const f = fixture(); const call = await f.start();
    await f.engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "第一段" });
    await f.engine.end("a", call.id); const first = await f.engine.document("a", call.id, "summary");
    await f.engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "u2", transcript: "晚到的重要條件" });
    expect((await f.engine.get("a", call.id)).documents.some(document => document.kind === "summary")).toBe(false);
    const updated = await f.engine.document("a", call.id, "summary");
    expect(updated.sourceRevision).toBeGreaterThan(first.sourceRevision!);
    expect(vi.mocked(f.documents.generate).mock.lastCall?.[1].transcript.map(line => line.text)).toContain("晚到的重要條件");
  });
  it.each(["report", "copy", "plan"] as const)("晚到條件使舊 %s 作廢", async kind => {
    const f = fixture(); const call = await f.start();
    await f.engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "初始條件" });
    await f.engine.end("a", call.id); await f.engine.document("a", call.id, kind);
    await f.engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "u2", transcript: "晚到的重要限制" });
    expect((await f.engine.get("a", call.id)).documents).toEqual([]);
  });
  it("等待辨識逾期後保留明確缺口，仍可產出有缺口註記的摘要", async () => {
    const f = fixture(); const call = await f.start();
    await f.engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "已知問題" });
    await f.engine.ingest("a", call.id, { type: "input_audio_buffer.committed", item_id: "u2" });
    await f.engine.end("a", call.id); f.advance(10000); await f.engine.failPendingTranscripts("a", call.id);
    const document = await f.engine.document("a", call.id, "summary");
    expect((await f.engine.get("a", call.id)).pendingTranscripts).toEqual([]);
    expect((await f.engine.get("a", call.id)).transcriptionFailures).toEqual(["u2"]);
    expect(document.findings.some(finding => finding.kind === "unknown" && finding.text.includes("1 段語音未能辨識"))).toBe(true);
  });
  it("30 天內可讀，期限到清單與直接存取皆刪除", async () => {
    const f = fixture(); const call = await f.start(); await f.engine.end("a", call.id);
    f.advance(30 * 86400000 - 1); expect(await f.engine.get("a", call.id)).toBeDefined();
    f.advance(1); expect(await f.engine.list("a")).toEqual([]);
    await expect(f.engine.get("a", call.id)).rejects.toMatchObject({ status: 404 });
    expect(f.data.has(`call:${call.id}`)).toBe(false);
  });
  it("結算服務中斷超過30天，刪除正文並保留不含內容的待對帳工作", async () => {
    const f = fixture(); const call = await f.start();
    await f.engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "需要到期刪除的合成內容" });
    const settle = vi.mocked(f.eccal.settle).getMockImplementation()!;
    vi.mocked(f.eccal.settle).mockRejectedValue(failure("ECCAL_UNAVAILABLE"));
    await expect(f.engine.end("a", call.id)).rejects.toThrow();
    f.advance(30 * 86400000); await f.engine.alarm();
    expect(f.data.has(`call:${call.id}`)).toBe(false);
    expect(JSON.stringify([...f.data.values()])).not.toContain("需要到期刪除的合成內容");
    await expect(f.start()).rejects.toMatchObject({ code: "SETTLEMENT_PENDING" });
    vi.mocked(f.eccal.settle).mockImplementation(settle); await f.engine.alarm();
    expect((await f.store.list("settlement:")).size).toBe(0); expect(await f.store.get("active")).toBeUndefined();
  });
  it.each(["summary", "report", "copy", "plan"] as const)("通話後產出 %s 並保留來源", async kind => {
    const f = fixture(); const call = await f.start();
    await f.engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "測試問題" });
    await f.engine.end("a", call.id); const document = await f.engine.document("a", call.id, kind);
    expect(document.kind).toBe(kind); expect(document.findings[0]?.sourceIds).toEqual(["u1"]);
  });
  it("真人交接格式包含六類必要資料", async () => {
    const f = fixture(); const call = await f.start(); await f.engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "問題" }); await f.engine.end("a", call.id); await f.engine.document("a", call.id, "summary");
    expect(Object.keys(handoff((await f.record(call.id))!))).toEqual(["memberId", "problemSummary", "confirmedFacts", "aiDiagnosis", "documents", "pendingQuestions"]);
  });
});

describe("交付狀態及領取碼", () => {
  function delivery(): Delivery { return { id: "d1", memberId: "a", documentId: "doc1", channel: "email", recipient: "fixture@example.invalid", verifiedAt: 1, state: "pending" }; }
  it.each(["unknown", "rejected"] as const)("%s 不標成成功", async outcome => {
    const d = delivery(); await sendDelivery(d, async () => ({ outcome }), async () => {});
    expect(d.state).toBe(outcome === "rejected" ? "failed" : "unknown");
  });
  it("通路有收據才記錄送出成功，重送遭拒", async () => {
    const d = delivery(); const send = vi.fn(async () => ({ outcome: "sent" as const, receipt: "fixture-receipt" }));
    await sendDelivery(d, send, async () => {});
    expect(d.state).toBe("succeeded"); await expect(sendDelivery(d, send, async () => {})).rejects.toMatchObject({ status: 409 }); expect(send).toHaveBeenCalledTimes(1);
  });
  it("收件人未核對不得寄出", async () => {
    const d = delivery(); d.verifiedAt = null; const send = vi.fn();
    await expect(sendDelivery(d, send, async () => {})).rejects.toMatchObject({ code: "RECIPIENT_UNVERIFIED" }); expect(send).not.toHaveBeenCalled();
  });
  it("LINE 沒有真人監督不得寄出", async () => {
    const d = delivery(); d.channel = "line";
    await expect(sendDelivery(d, vi.fn(), async () => {})).rejects.toMatchObject({ code: "LINE_SUPERVISION_REQUIRED" });
  });
  it("錯人、錯碼、到期及重複核銷皆拒絕", () => {
    const claim = { memberId: "a", deliveryId: "d1", digest: "fixture-digest", expiresAt: 100, usedAt: null };
    const input = { memberId: "a", deliveryId: "d1", digest: "fixture-digest", now: 1 };
    for (const bad of [{ ...input, memberId: "b" }, { ...input, digest: "wrong" }, { ...input, now: 100 }]) expect(() => redeemClaim(claim, bad)).toThrow();
    const redeemed = redeemClaim(claim, input); expect(() => redeemClaim(redeemed, input)).toThrow();
  });
});

describe("Cloudflare 路由與實際 Durable Object 儲存", () => {
  const runtime = env as unknown as Env;
  it("缺 ECCAL 綁定拒絕發證，不回傳任何金鑰", async () => {
    const response = await worker.fetch(new Request("https://fixture.invalid/api/me"), runtime);
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "ECCAL_NOT_CONFIGURED" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("跨站開始請求先拒絕，不呼叫會員服務", async () => {
    const f = fixture(); const response = await worker.fetch(new Request("https://fixture.invalid/api/calls", { method: "POST", headers: { origin: "https://attacker.invalid" }, body: "v=0" }), { ...runtime, APP_ORIGIN: "https://fixture.invalid", ECCAL: f.eccal });
    expect(response.status).toBe(403); expect(f.eccal.authenticate).not.toHaveBeenCalled();
  });
  it("失效登入為 401", async () => {
    const f = fixture(); const response = await worker.fetch(new Request("https://fixture.invalid/api/me", { headers: { cookie: "expired" } }), { ...runtime, ECCAL: f.eccal });
    expect(response.status).toBe(401);
  });
  it.each(["authenticate", "balance"] as const)("ECCAL %s 網路失敗維持服務錯誤", async method => {
    const f = fixture(); vi.mocked(f.eccal[method]).mockRejectedValueOnce(new TypeError("fixture-network-failure"));
    const response = await worker.fetch(new Request("https://fixture.invalid/api/me", { headers: { cookie: "fixture=a" } }), { ...runtime, ECCAL: f.eccal });
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
  });
  it("輸入 SDP 的 UTF-8 無效則為 400", async () => {
    const f = fixture(); const response = await worker.fetch(new Request("https://fixture.invalid/api/calls", { method: "POST", headers: { origin: "https://fixture.invalid", cookie: "fixture=a", "content-type": "application/sdp" }, body: new Uint8Array([0xff]) }), { ...runtime, APP_ORIGIN: "https://fixture.invalid", ECCAL: f.eccal });
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "INVALID_REQUEST" });
  });
  it("RPC 業務錯誤保留 403，拒絕後可繼續讀取同一個 Object", async () => {
    const stub = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(crypto.randomUUID()));
    const result = await stub.start({ memberId: "a", eligible: false }, crypto.randomUUID(), "v=0");
    expect(result).toEqual({ ok: false, error: "MEMBER_INELIGIBLE", status: 403 });
    expect(await stub.records("a")).toEqual({ ok: true, value: [] });
  });
  it("兩個分頁同時搶最後一秒，實際 RPC 序列只建立一通", async () => {
    const f = fixture(); f.balances.set("a", 1);
    const stub = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, async instance => {
      (instance as unknown as { engine: typeof f.engine }).engine = f.engine;
      vi.spyOn(instance as unknown as { attach: () => Promise<void> }, "attach").mockResolvedValue();
    });
    const results = await Promise.all([stub.start({ memberId: "a", eligible: true }, crypto.randomUUID(), "v=0"), stub.start({ memberId: "a", eligible: true }, crypto.randomUUID(), "v=0")]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toEqual([{ ok: false, error: "CALL_ALREADY_ACTIVE", status: 409 }]);
    expect(f.realtime.create).toHaveBeenCalledTimes(1);
    const created = results.find(result => result.ok)!;
    if (created.ok) await stub.stop("a", created.value.id);
  });
  it("獨立截止 Object 確認掛斷後，結算失敗仍不重送提供者掛斷", async () => {
    const f = fixture(); const call = await f.start(); const record = (await f.record(call.id))!;
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("a")))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const memberStub = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(hash));
    await runInDurableObject(memberStub, async (_instance, state) => { await state.storage.put(`call:${record.id}`, record); });
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const cutoff = runtime.CUTOFFS.get(runtime.CUTOFFS.idFromName(crypto.randomUUID()));
    await cutoff.arm({ memberId: "a", recordId: record.id, callId: "rtc_fixture", deadline: Date.now() - 1, meterRevision: record.events.length });
    await runDurableObjectAlarm(cutoff);
    expect(await runDurableObjectAlarm(cutoff)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/\/rtc_fixture\/hangup$/);
    await runInDurableObject(cutoff, async (_instance, state) => { expect(await state.storage.get("call")).toBeUndefined(); expect(await state.storage.getAlarm()).toBeNull(); });
    await runInDurableObject(memberStub, async (_instance, state) => { expect((await state.storage.get<{ at: number }>(`provider-end:${record.id}`))?.at).toBeTypeOf("number"); await state.storage.deleteAll(); await state.storage.deleteAlarm(); });
  });
  it("SQLite 儲存與 alarm 確實移除到期全文", async () => {
    const f = fixture(); const call = await f.start(); await f.engine.end("a", call.id);
    const record = (await f.record(call.id))!; record.expiresAt = Date.now() - 1;
    const stub = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, async (_instance, state) => { await state.storage.put(`call:${record.id}`, record); await state.storage.setAlarm(Date.now() + 100000); });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (_instance, state) => { expect(await state.storage.get(`call:${record.id}`)).toBeUndefined(); });
  });
  it("另一控制器先完成掛斷，截止重送 404 可依持久證據收斂", async () => {
    const f = fixture(); const call = await f.start(); await f.engine.end("a", call.id);
    const record = (await f.record(call.id))!;
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("a")))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const memberStub = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(hash));
    await runInDurableObject(memberStub, async (_instance, state) => { await state.storage.put(`call:${record.id}`, record); });
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    const cutoff = runtime.CUTOFFS.get(runtime.CUTOFFS.idFromName(crypto.randomUUID()));
    await cutoff.arm({ memberId: "a", recordId: record.id, callId: "rtc_fixture", deadline: Date.now() - 1, meterRevision: record.events.length });
    await runDurableObjectAlarm(cutoff);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await runInDurableObject(cutoff, async (_instance, state) => { expect(await state.storage.get("call")).toBeUndefined(); expect(await state.storage.getAlarm()).toBeNull(); });
    await runInDurableObject(memberStub, async (_instance, state) => { await state.storage.deleteAll(); });
  });
  it("手動掛斷正在等待 ECCAL 結算，截止仍可確認並取消自身 alarm", async () => {
    const f = fixture(); const call = await f.start(); const record = (await f.record(call.id))!;
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("a")))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const memberStub = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(hash));
    let finish!: (result: { billedSeconds: number; remainingSeconds: number }) => void;
    vi.mocked(f.eccal.settle).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await runInDurableObject(memberStub, async (instance, state) => {
      f.deps.store = {
        get: key => state.storage.get(key), put: (key, value) => state.storage.put(key, value),
        delete: async key => { await state.storage.delete(key); }, list: prefix => state.storage.list({ prefix }), alarm: at => state.storage.setAlarm(at),
      };
      await state.storage.put(`call:${record.id}`, record);
      (instance as unknown as { engine: typeof f.engine }).engine = f.engine;
    });
    const stopping = memberStub.stop("a", record.id);
    await vi.waitFor(() => expect(f.eccal.settle).toHaveBeenCalledTimes(1));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    const cutoff = runtime.CUTOFFS.get(runtime.CUTOFFS.idFromName(crypto.randomUUID()));
    await cutoff.arm({ memberId: "a", recordId: record.id, callId: "rtc_fixture", deadline: Date.now() - 1, meterRevision: record.events.length });
    await runDurableObjectAlarm(cutoff);
    expect(await runDurableObjectAlarm(cutoff)).toBe(false);
    await runInDurableObject(cutoff, async (_instance, state) => { expect(await state.storage.get("call")).toBeUndefined(); });
    await runInDurableObject(memberStub, async () => { finish({ billedSeconds: 0, remainingSeconds: 300 }); });
    expect((await stopping).ok).toBe(true);
    await runInDurableObject(memberStub, async (_instance, state) => { await state.storage.deleteAll(); await state.storage.deleteAlarm(); });
  });
  it("真實 drain timer 到期會解除 pending，並產生附缺口的摘要", async () => {
    const f = fixture(); const call = await f.start();
    await f.engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "已辨識的問題" });
    await f.engine.ingest("a", call.id, { type: "input_audio_buffer.committed", item_id: "u2" });
    const record = (await f.record(call.id))!;
    const stub = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, async (instance, state) => {
      f.deps.store = {
        get: key => state.storage.get(key), put: (key, value) => state.storage.put(key, value),
        delete: async key => { await state.storage.delete(key); }, list: prefix => state.storage.list({ prefix }), alarm: at => state.storage.setAlarm(at),
      };
      await state.storage.put(`call:${record.id}`, record);
      (instance as unknown as { engine: typeof f.engine }).engine = f.engine;
    });
    expect((await stub.stop("a", record.id)).ok).toBe(true);
    await vi.waitFor(async () => {
      const result = await stub.record("a", record.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pendingTranscripts).toBe(0);
        expect(result.value.transcriptionFailures).toBe(1);
        expect(result.value.documents.some(document => document.kind === "summary" && document.findings.some(finding => finding.kind === "unknown"))).toBe(true);
      }
    }, { timeout: 12000, interval: 100 });
    await runInDurableObject(stub, async (_instance, state) => { await state.storage.deleteAll(); await state.storage.deleteAlarm(); });
  });
});
