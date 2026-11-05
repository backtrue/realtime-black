import { describe, expect, it, vi } from "vitest";
import { OpenAiRealtime, OpenAiDocuments } from "../src/openai";
import { ThinkWithBlackMcp } from "../src/mcp";
import { fixture } from "./fixture";

describe("OpenAI 短效憑證與後端掛斷", () => {
  it.each(["https://api.openai.com/v1/realtime/calls/rtc_fixture", "/v1/realtime/calls/rtc_fixture"])("接受 Location %s，回傳值不含任何憑證", async location => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ value: "ek_fixture", expires_at: Math.floor(Date.now() / 1000) + 10 })).mockResolvedValueOnce(new Response("v=0\r\nanswer", { status: 201, headers: { location } }));
    const client = new OpenAiRealtime("server-fixture-key", "fixture-model", fetcher);
    const result = await client.create("v=0\r\noffer", []);
    expect(result).toEqual({ callId: "rtc_fixture", sdp: "v=0\r\nanswer" });
    expect(JSON.stringify(result)).not.toMatch(/ek_fixture|server-fixture-key/);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer server-fixture-key");
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("authorization")).toBe("Bearer ek_fixture");
  });
  it("過期短效憑證不建立會話", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ value: "ek_fixture", expires_at: 1 }));
    await expect(new OpenAiRealtime("fixture-key", "fixture-model", fetcher).create("v=0", [])).rejects.toMatchObject({ code: "REALTIME_CREDENTIAL_INVALID" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("外部 Location 不能成為後端控制入口", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ value: "ek_fixture", expires_at: Math.floor(Date.now() / 1000) + 10 })).mockResolvedValueOnce(new Response("v=0", { headers: { location: "https://attacker.invalid/rtc_fixture" } }));
    await expect(new OpenAiRealtime("fixture-key", "fixture-model", fetcher).create("v=0", [])).rejects.toMatchObject({ code: "REALTIME_CALL_ID_INVALID" });
  });
  it("使用伺服器金鑰掛斷指定通話，拒絕注入路徑", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const client = new OpenAiRealtime("fixture-key", "fixture-model", fetcher);
    await client.hangup("rtc_fixture"); expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/realtime/calls/rtc_fixture/hangup");
    await expect(client.hangup("../../other")).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("提供者明確確認既有會話不存在時，可以完成結束", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { type: "invalid_request_error", code: "call_id_not_found", message: "No session found for the provided call_id" } }, { status: 404 }));
    await expect(new OpenAiRealtime("fixture-key", "fixture-model", fetcher).hangup("rtc_fixture")).resolves.toBeUndefined();
  });
  it.each([
    [404, { error: { code: "other_error", type: "invalid_request_error" } }],
    [404, { error: { code: "call_id_not_found", type: "server_error" } }],
    [401, { error: { code: "call_id_not_found", type: "invalid_request_error" } }],
    [500, { error: { code: "call_id_not_found", type: "invalid_request_error" } }],
  ] as const)("不以狀態 %s 的其他錯誤確認結束", async (status, body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));
    await expect(new OpenAiRealtime("fixture-key", "fixture-model", fetcher).hangup("rtc_fixture")).rejects.toMatchObject({ code: "REALTIME_HANGUP_FAILED" });
  });
  it("無法讀取的 404 不確認結束", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("unreadable", { status: 404 }));
    await expect(new OpenAiRealtime("fixture-key", "fixture-model", fetcher).hangup("rtc_fixture")).rejects.toMatchObject({ code: "REALTIME_HANGUP_FAILED" });
  });
  it("斷線後會話不存在的確認僅結算一次，下一通從正確餘額開始", async () => {
    const f = fixture(); const call = await f.start();
    await f.engine.ingest("a", call.id, { type: "output_audio_buffer.started", event_id: "actual-audio" });
    f.advance(1250);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { type: "invalid_request_error", code: "call_id_not_found" } }, { status: 404 }));
    f.deps.realtime = new OpenAiRealtime("fixture-key", "fixture-model", fetcher);
    const ended = await f.engine.end("a", call.id);
    expect(ended.status).toBe("ended");
    expect(ended.settlement).toEqual({ billedSeconds: 2, remainingSeconds: 298 });
    expect(ended.endedAt).toBe(f.now());
    await f.engine.end("a", call.id); await f.engine.alarm();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(f.eccal.settle).toHaveBeenCalledTimes(1);
    f.deps.realtime = f.realtime;
    const next = await f.start();
    expect((await f.record(next.id))?.reservation.seconds).toBe(298);
    expect(await f.eccal.balance("b")).toBe(300);
  });
});

describe("成果內容驗證", () => {
  it("拒絕不存在的來源，OpenAI 不保存此產出請求", async () => {
    const f = fixture(); const call = await f.start(); await f.engine.end("a", call.id);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ kind: "report", title: "fixture", findings: [{ kind: "tool", text: "假資料", sourceIds: ["missing-source"] }] }) }] }] }));
    await expect(new OpenAiDocuments("fixture-key", "fixture-model", fetcher).generate("report", (await f.record(call.id))!)).rejects.toMatchObject({ code: "DOCUMENT_RESPONSE_INVALID" });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).store).toBe(false);
  });
  it.each(["member", "tool"] as const)("拒絕來源分類誤標為 %s", async mislabeledKind => {
    const f = fixture(); const call = await f.start();
    const record = (await f.record(call.id))!;
    record.transcript = [{ itemId: "user-source", role: "user", text: "會員口述", at: f.now() }];
    record.tools = [{ id: "tool-source", name: "read_method", result: { evidence: "工具資料" } }];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ kind: "report", title: "fixture", findings: [{ kind: mislabeledKind, text: "測試錯誤分類", sourceIds: [mislabeledKind === "tool" ? "user-source" : "tool-source"] }] }) }] }] }));
    await expect(new OpenAiDocuments("fixture-key", "fixture-model", fetcher).generate("report", record)).rejects.toMatchObject({ code: "DOCUMENT_RESPONSE_INVALID" });
  });
});

describe("MCP 會員權杖與協定", () => {
  const grant = () => ({ memberId: "a", accessToken: "fixture-member-token", expiresAt: Date.now() + 60000, readOnlyTools: ["read_method"] });
  it("未授權工具不產生任何外部請求", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new ThinkWithBlackMcp(fetcher).call(grant(), "pause_ad", {})).rejects.toMatchObject({ code: "TOOL_FORBIDDEN" }); expect(fetcher).not.toHaveBeenCalled();
  });
  it("過期權杖不送出", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new ThinkWithBlackMcp(fetcher).list({ ...grant(), expiresAt: 1 })).rejects.toMatchObject({ code: "MCP_AUTH_EXPIRED" }); expect(fetcher).not.toHaveBeenCalled();
  });
  it("SDK 走完協定並只匯入授權的唯讀工具", async () => {
    const methods: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-member-token");
      const body = JSON.parse(String(init?.body)); methods.push(body.method);
      let result: unknown;
      if (body.method === "server/discover") result = { protocolVersions: ["2026-07-28"], capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } };
      else if (body.method === "initialize") result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } };
      else if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      else result = { tools: [{ name: "read_method", description: "fixture", inputSchema: { type: "object", properties: {} } }, { name: "pause_ad", inputSchema: { type: "object", properties: {} } }] };
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    });
    const tools = await new ThinkWithBlackMcp(fetcher).list(grant());
    expect(tools.map(tool => tool.name)).toEqual(["read_method"]); expect(methods).toContain("tools/list");
  });
});
