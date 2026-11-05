import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { fixture } from "./fixture";
import worker, { type Env } from "../src/worker";
import type { DeliveryPort } from "../src/contracts";

async function prepared() {
  const f = fixture(); const call = await f.start();
  await f.engine.ingest("a", call.id, { type: "input_audio_buffer.speech_started", event_id: "actual-audio" });
  await f.engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "合成諮詢內容" });
  await f.engine.end("a", call.id); const document = await f.engine.document("a", call.id, "report");
  const verify = vi.fn<DeliveryPort["verify"]>(async job => ({ memberId: job.memberId, jobId: job.id, documentId: job.documentId, recipient: job.channel === "email" ? job.recipient : "fixture-chatroom", verifiedAt: f.now(), supervised: true }));
  const send = vi.fn<DeliveryPort["send"]>(async () => ({ outcome: "sent", receipt: "fixture-receipt" }));
  f.deps.delivery = { verify, send }; f.deps.appOrigin = "https://fixture.invalid";
  const request = (channel: "email" | "line" = "email", operationId = crypto.randomUUID()) => f.engine.requestDelivery("a", call.id, { documentId: document.id, channel, recipient: channel === "email" ? "fixture@example.invalid" : "", operationId });
  return { ...f, call, document, request, verify, send };
}

describe("持久交付工作", () => {
  it("建立待寄送工作不代表已送出，重播同一請求只保存一筆", async () => {
    const f = await prepared(); const op = crypto.randomUUID();
    const first = await f.request("email", op); const replay = await f.request("email", op);
    expect(first.job.state).toBe("pending"); expect(first.job.verifiedAt).toBeNull(); expect(replay.job.id).toBe(first.job.id);
    expect((await f.record(f.call.id))?.deliveries).toHaveLength(1); expect(f.send).not.toHaveBeenCalled();
  });
  it("相同操作不能替換收件人", async () => {
    const f = await prepared(); const op = crypto.randomUUID(); await f.request("email", op);
    await expect(f.engine.requestDelivery("a", f.call.id, { documentId: f.document.id, channel: "email", recipient: "other@example.invalid", operationId: op })).rejects.toMatchObject({ code: "OPERATION_REPLAYED" });
  });
  it("其他會員不能建立或派送本人的成果", async () => {
    const f = await prepared(); const created = await f.request();
    await expect(f.engine.requestDelivery("b", f.call.id, { documentId: f.document.id, channel: "email", recipient: "other@example.invalid", operationId: crypto.randomUUID() })).rejects.toMatchObject({ status: 404 });
    await expect(f.engine.dispatchDelivery("b", f.call.id, created.job.id, {})).rejects.toMatchObject({ status: 404 });
    expect(f.send).not.toHaveBeenCalled();
  });
  it("LINE 領取碼只回傳一次，儲存端保留雜湊", async () => {
    const f = await prepared(); const op = crypto.randomUUID(); const created = await f.request("line", op);
    expect(created.claimCode).toMatch(/^[a-f0-9]{32}$/); expect(created.job.claimDigest).toHaveLength(64);
    expect(JSON.stringify([...f.data.values()])).not.toContain(created.claimCode);
    expect((await f.request("line", op)).claimCode).toBeUndefined();
  });
  it("錯誤領取碼不進行收件人核對或寄送", async () => {
    const f = await prepared(); const created = await f.request("line");
    await expect(f.engine.dispatchDelivery("a", f.call.id, created.job.id, {}, "wrong")).rejects.toMatchObject({ code: "CLAIM_INVALID" });
    expect(f.verify).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("LINE 需由核對 adapter 確認有人監督", async () => {
    const f = await prepared(); const created = await f.request("line");
    f.verify.mockResolvedValueOnce({ memberId: "a", jobId: created.job.id, documentId: f.document.id, recipient: "fixture-chatroom", verifiedAt: f.now(), supervised: false });
    await expect(f.engine.dispatchDelivery("a", f.call.id, created.job.id, {}, created.claimCode)).rejects.toMatchObject({ code: "LINE_SUPERVISION_REQUIRED" });
    expect(f.send).not.toHaveBeenCalled();
  });
  it("核對後送出並保存收據，成功領取碼不可再次發送", async () => {
    const f = await prepared(); const created = await f.request("line");
    const sent = await f.engine.dispatchDelivery("a", f.call.id, created.job.id, { fixtureProof: true }, created.claimCode);
    expect(sent.state).toBe("succeeded"); expect(sent.providerReceipt).toBe("fixture-receipt"); expect(sent.claimedAt).toBe(f.now());
    expect(f.send.mock.calls[0]?.[1]).toBe(`https://fixture.invalid/#call=${f.call.id}&document=${f.document.id}`);
    await expect(f.engine.dispatchDelivery("a", f.call.id, created.job.id, {}, created.claimCode)).rejects.toMatchObject({ status: 409 }); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each(["unknown", "rejected"] as const)("通路 %s 結果保存為不明或失敗", async outcome => {
    const f = await prepared(); const created = await f.request(); f.send.mockResolvedValueOnce({ outcome });
    const sent = await f.engine.dispatchDelivery("a", f.call.id, created.job.id, {});
    expect(sent.state).toBe(outcome === "unknown" ? "unknown" : "failed");
    expect((await f.record(f.call.id))?.deliveries[0]?.state).toBe(sent.state);
  });
  it("Email 核對結果必須與會員指定地址一致", async () => {
    const f = await prepared(); const created = await f.request();
    f.verify.mockResolvedValueOnce({ memberId: "a", jobId: created.job.id, documentId: f.document.id, recipient: "other@example.invalid", verifiedAt: f.now(), supervised: true });
    await expect(f.engine.dispatchDelivery("a", f.call.id, created.job.id, {})).rejects.toMatchObject({ code: "RECIPIENT_UNVERIFIED" }); expect(f.send).not.toHaveBeenCalled();
  });
  it("逐字稿更新後待寄送工作作廢，不能寄出舊成果", async () => {
    const f = await prepared(); const created = await f.request();
    await f.engine.ingest("a", f.call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "u2", transcript: "晚到的重要條件" });
    expect((await f.record(f.call.id))?.deliveries[0]).toMatchObject({ state: "failed", failureCode: "DOCUMENT_STALE" });
    await expect(f.engine.dispatchDelivery("a", f.call.id, created.job.id, {})).rejects.toMatchObject({ code: "DOCUMENT_STALE" }); expect(f.send).not.toHaveBeenCalled();
  });
  it("紀錄到期後不能領取或派送成果", async () => {
    const f = await prepared(); const created = await f.request("line"); f.advance(30 * 86400000);
    await expect(f.engine.dispatchDelivery("a", f.call.id, created.job.id, {}, created.claimCode)).rejects.toMatchObject({ status: 404 }); expect(f.send).not.toHaveBeenCalled();
  });
  it("實際 RPC 同時派送同一工作只送一次", async () => {
    const f = await prepared(); const created = await f.request(); const runtime = env as unknown as Env;
    const stub = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, async instance => { (instance as unknown as { engine: typeof f.engine }).engine = f.engine; });
    const results = await Promise.all([stub.dispatchDelivery("a", f.call.id, created.job.id, {}), stub.dispatchDelivery("a", f.call.id, created.job.id, {})]);
    expect(results.filter(result => result.ok)).toHaveLength(1); expect(f.send).toHaveBeenCalledTimes(1);
    const rejected = results.find(result => !result.ok); expect(rejected).toMatchObject({ ok: false, status: 409 });
  });
  it("HTTP 入口不能附帶已核對旗標或派送指令", async () => {
    const f = await prepared(); const runtime = env as unknown as Env;
    const response = await worker.fetch(new Request(`https://fixture.invalid/api/calls/${f.call.id}/deliveries`, { method: "POST", headers: { origin: "https://fixture.invalid", cookie: "fixture=a", "content-type": "application/json" }, body: JSON.stringify({ documentId: f.document.id, channel: "email", recipient: "fixture@example.invalid", operationId: crypto.randomUUID(), verifiedAt: f.now() }) }), { ...runtime, APP_ORIGIN: "https://fixture.invalid", ECCAL: f.eccal });
    expect(response.status).toBe(400); expect(f.send).not.toHaveBeenCalled();
  });
  it("摘要不開放成果交付", async () => {
    const f = await prepared(); const summary = await f.engine.document("a", f.call.id, "summary");
    await expect(f.engine.requestDelivery("a", f.call.id, { documentId: summary.id, channel: "email", recipient: "fixture@example.invalid", operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });
  it("核對證據不能套用到另一筆工作", async () => {
    const f = await prepared(); const created = await f.request();
    f.verify.mockResolvedValueOnce({ memberId: "a", jobId: "other-job", documentId: f.document.id, recipient: created.job.recipient, verifiedAt: f.now(), supervised: true });
    await expect(f.engine.dispatchDelivery("a", f.call.id, created.job.id, {})).rejects.toMatchObject({ code: "RECIPIENT_UNVERIFIED" }); expect(f.send).not.toHaveBeenCalled();
  });
  it("派送中 isolate 中斷，alarm 保存結果不明且不重送", async () => {
    const f = await prepared(); const created = await f.request();
    const record = (await f.record(f.call.id))!; record.deliveries[0]!.state = "sending";
    await f.store.put(`call:${record.id}`, record); await f.engine.alarm();
    expect((await f.record(f.call.id))?.deliveries[0]?.state).toBe("unknown");
    await expect(f.engine.dispatchDelivery("a", f.call.id, created.job.id, {})).rejects.toMatchObject({ status: 409 }); expect(f.send).not.toHaveBeenCalled();
  });
  it("HTTP 建立 LINE 待辦後可查狀態，讀回不包含碼或雜湊", async () => {
    const f = await prepared(); const runtime = env as unknown as Env;
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("a")))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const stub = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(hash));
    await runInDurableObject(stub, async instance => { (instance as unknown as { engine: typeof f.engine }).engine = f.engine; });
    const config = { ...runtime, APP_ORIGIN: "https://fixture.invalid", ECCAL: f.eccal };
    const response = await worker.fetch(new Request(`https://fixture.invalid/api/calls/${f.call.id}/deliveries`, { method: "POST", headers: { origin: "https://fixture.invalid", cookie: "fixture=a", "content-type": "application/json" }, body: JSON.stringify({ documentId: f.document.id, channel: "line", recipient: "", operationId: crypto.randomUUID() }) }), config);
    expect(response.status).toBe(201);
    const created = await response.json() as { claimCode: string; job: { id: string; state: string } };
    expect(created.claimCode).toMatch(/^[a-f0-9]{32}$/); expect(created.job.state).toBe("pending");
    const read = await worker.fetch(new Request(`https://fixture.invalid/api/calls/${f.call.id}`, { headers: { cookie: "fixture=a" } }), config);
    const text = await read.text();
    expect(text).toContain(created.job.id); expect(text).not.toContain(created.claimCode); expect(text).not.toContain("claimDigest"); expect(text).not.toContain("memberId");
    expect(f.send).not.toHaveBeenCalled();
  });
});
