import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/client/validators/cf-worker";
import { AppError, type McpGrant, type McpPort, type Tool } from "./contracts";

const MCP_URL = "https://mcp.thinkwithblack.com/mcp";
export class ThinkWithBlackMcp implements McpPort {
  constructor(private fetcher: typeof fetch = fetch.bind(globalThis)) {}
  private async withClient<T>(grant: McpGrant, action: (client: Client, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= Date.now() || !grant.accessToken || !grant.memberId) throw new AppError("MCP_AUTH_EXPIRED", 403);
    const signal = AbortSignal.timeout(10000);
    const client = new Client({ name: "realtime-black", version: "0.1.0" }, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { authorization: `Bearer ${grant.accessToken}` }, redirect: "manual" },
      fetch: async (input, init) => {
        const url = typeof input === "string" ? input : input.href;
        if (url !== MCP_URL) throw new AppError("MCP_ORIGIN_FORBIDDEN", 403);
        const response = await this.fetcher(input, { ...init, redirect: "manual", signal });
        if (response.status === 401 || response.status === 403) throw new AppError('MCP_AUTH_REVOKED', 403);
        if (response.status >= 300 && response.status < 400) throw new AppError("MCP_REDIRECT_FORBIDDEN", 502);
        if (!response.body) return response;
        const reader = response.body.getReader();
        let bytes = 0;
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const item = await reader.read();
            if (item.done) { controller.close(); reader.releaseLock(); return; }
            bytes += item.value.byteLength;
            if (bytes > 1024 * 1024) { await reader.cancel(); controller.error(new AppError("MCP_RESPONSE_INVALID", 502)); return; }
            controller.enqueue(item.value);
          },
          async cancel(reason) { await reader.cancel(reason); },
        });
        return new Response(body, response);
      },
    });
    try {
      await client.connect(transport, { signal, timeout: 10000 });
      return await action(client, signal);
    } catch (error) { throw error instanceof AppError ? error : new AppError("MCP_UNAVAILABLE", 502); }
    finally { await client.close(); }
  }
  async account(grant: McpGrant): Promise<string> {
    return this.withClient(grant, async (client, signal) => {
      const result = await client.callTool({ name: 'thinkwithblack_get_account_status', arguments: {} }, { signal, timeout: 10000 });
      const structured = result.structuredContent as { account_email?: unknown } | undefined;
      if (result.isError || 'inputRequests' in result || typeof structured?.account_email !== 'string' || structured.account_email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(structured.account_email)) throw new AppError('MCP_ACCOUNT_UNAVAILABLE', 502);
      return structured.account_email;
    });
  }
  async list(grant: McpGrant): Promise<Tool[]> {
    return this.withClient(grant, async (client, signal) => {
      const tools: Tool[] = [];
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: 10000 });
        for (const tool of page.tools) if (grant.readOnlyTools.includes(tool.name)) tools.push({ name: tool.name, description: tool.description ?? "", parameters: tool.inputSchema });
        cursor = page.nextCursor;
        if (cursor && (cursors.has(cursor) || cursors.size >= 20)) throw new AppError("MCP_TOOL_LIST_INVALID", 502);
        if (cursor) cursors.add(cursor);
      } while (cursor);
      return tools;
    });
  }
  async call(grant: McpGrant, name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!grant.readOnlyTools.includes(name)) throw new AppError("TOOL_FORBIDDEN", 403);
    return this.withClient(grant, async (client, signal) => {
      const result = await client.callTool({ name, arguments: args }, { signal, timeout: 10000 });
      if (result.isError || "inputRequests" in result) throw new AppError("TOOL_FAILED", 502);
      return result;
    });
  }
}
