import { AppError, type SharedMethodsPort, type Tool } from "./contracts";

export const SHARED_METHOD_TOOLS = ["thinkwithblack_entry_catalog", "thinkwithblack_entry_read", "thinkwithblack_marketing_skill_search", "thinkwithblack_marketing_skill_read"] as const;
const argumentKeys: Record<string, readonly string[]> = {
  thinkwithblack_entry_catalog: [], thinkwithblack_entry_read: ["entry_id"],
  thinkwithblack_marketing_skill_search: ["query", "cursor"], thinkwithblack_marketing_skill_read: ["id"],
};
export interface MethodService {
  list(): Promise<Tool[]>;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
}
export class DefaultMethods implements SharedMethodsPort {
  constructor(private service?: MethodService) {}
  private async request<T>(action: (service: MethodService) => Promise<T>): Promise<T> {
    if (!this.service) throw new AppError("METHODS_UNAVAILABLE", 503);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([action(this.service), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AppError("METHODS_UNAVAILABLE", 503)), 10000); })]);
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1024 * 1024) throw new Error("RESPONSE_TOO_LARGE");
      return result;
    } catch { throw new AppError("METHODS_UNAVAILABLE", 503); }
    finally { clearTimeout(timer); }
  }
  async list(): Promise<Tool[]> {
    const tools = await this.request(service => service.list());
    if (!Array.isArray(tools) || tools.length !== SHARED_METHOD_TOOLS.length || new Set(tools.map(tool => tool?.name)).size !== tools.length || tools.some(tool => !SHARED_METHOD_TOOLS.some(name => name === tool?.name) || typeof tool.description !== "string" || !tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters))) throw new AppError("METHODS_UNAVAILABLE", 503);
    return tools;
  }
  async call(name: string, args: Record<string, unknown>) {
    if (!Object.hasOwn(argumentKeys, name) || !args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(key => !argumentKeys[name]!.includes(key)) || JSON.stringify(args).length > 16384) throw new AppError("TOOL_FORBIDDEN", 403);
    const result = await this.request(service => service.call(name, args)) as { isError?: unknown; content?: unknown } | null;
    if (!result || result.isError || !Array.isArray(result.content) || result.content.some(part => !part || typeof part !== "object" || part.type !== "text" || typeof part.text !== "string")) throw new AppError("METHODS_UNAVAILABLE", 503);
    return result;
  }
}
