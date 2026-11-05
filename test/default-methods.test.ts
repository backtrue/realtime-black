import { describe, expect, it, vi } from "vitest";
import { DefaultMethods, SHARED_METHOD_TOOLS, type MethodService } from "../src/default-methods";
import { authRoutes } from "../src/auth-routes";

const tools = () => SHARED_METHOD_TOOLS.map(name => ({ name, description: "fixture", parameters: { type: "object", properties: {}, additionalProperties: false } }));
const service = (): MethodService => ({ list: vi.fn(async () => tools()), call: vi.fn(async () => ({ content: [{ type: "text", text: "fixture-shared-method" }], structuredContent: { source: "fixture" } })) });

describe("語音站預設讀取小黑行銷方法", () => {
  it("直接使用內部方法服務，不傳個人身分、Cookie 或 OAuth 權杖", async () => {
    const rpc = service(), methods = new DefaultMethods(rpc);
    expect(await methods.list()).toEqual(tools());
    expect(await methods.call("thinkwithblack_marketing_skill_read", { id: "MK-453" })).toMatchObject({ structuredContent: { source: "fixture" } });
    expect(rpc.list).toHaveBeenCalledWith();
    expect(rpc.call).toHaveBeenCalledWith("thinkwithblack_marketing_skill_read", { id: "MK-453" });
  });
  it("無內部綁定或服務失敗時拒絕，不改用個人 OAuth", async () => {
    await expect(new DefaultMethods().list()).rejects.toMatchObject({ code: "METHODS_UNAVAILABLE" });
    const rpc = service(); vi.mocked(rpc.call).mockRejectedValueOnce(new Error("fixture-private"));
    await expect(new DefaultMethods(rpc).call("thinkwithblack_entry_catalog", {})).rejects.toMatchObject({ code: "METHODS_UNAVAILABLE", message: "METHODS_UNAVAILABLE" });
  });
  it.each(["gsc_query", "pause_ad", "thinkwithblack_get_account_status", "thinkwithblack_brand_context_read"])("%s 不會外送", async name => {
    const rpc = service();
    await expect(new DefaultMethods(rpc).call(name, {})).rejects.toMatchObject({ code: "TOOL_FORBIDDEN" });
    expect(rpc.call).not.toHaveBeenCalled();
  });
  it.each(["brand_key", "memberId", "execution", "context_sections"])("不會外送夾帶 %s 的參數", async field => {
    const rpc = service();
    await expect(new DefaultMethods(rpc).call("thinkwithblack_marketing_skill_read", { id: "MK-453", [field]: "fixture-private" })).rejects.toMatchObject({ code: "TOOL_FORBIDDEN" });
    expect(rpc.call).not.toHaveBeenCalled();
  });
  it("拒絕不完整或混入其他工具的服務清單", async () => {
    const rpc = service(); vi.mocked(rpc.list).mockResolvedValueOnce([{ name: "pause_ad", description: "fixture", parameters: {} }]);
    await expect(new DefaultMethods(rpc).list()).rejects.toMatchObject({ code: "METHODS_UNAVAILABLE" });
  });
  it("拒絕工具失敗或超過大小上限的結果", async () => {
    const rpc = service(); vi.mocked(rpc.call).mockResolvedValueOnce({ isError: true, content: [] }).mockResolvedValueOnce({ content: [{ type: "text", text: "x".repeat(1024 * 1024) }] });
    const methods = new DefaultMethods(rpc);
    for (let index = 0; index < 2; index++) await expect(methods.call("thinkwithblack_entry_catalog", {})).rejects.toMatchObject({ code: "METHODS_UNAVAILABLE" });
  });
  it("登入狀態只確認 ECCAL，不取得個人 MCP grant", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ memberId: "fixture-member", eligible: true }, { headers: { "x-voice-contract": "eccal-voice-v1" } }));
    const vault = vi.fn((): never => { throw new Error("PERSONAL_GRANT_FORBIDDEN"); });
    try {
      const response = await authRoutes(new Request("https://voice.example.test/auth/status", { headers: { cookie: "fixture=session" } }), { APP_ORIGIN: "https://voice.example.test", ECCAL_ORIGIN: "https://eccal.example.test", ECCAL_SERVICE_TOKEN: "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk" }, vault);
      expect(await response.json()).toEqual({ authenticated: true });
      expect(vault).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { fetcher.mockRestore(); }
  });
});
