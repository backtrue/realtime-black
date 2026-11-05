export const MAX_ASSISTANT_AUDIO_CHARS = 20 * 1024 * 1024;
type Item = { responseId: string; at: number };
type Pending = { begin: Promise<void>; timer: ReturnType<typeof setTimeout>; requested: boolean; received: boolean; audioEndMs?: number; audio?: string; at: number };
type Hooks = {
  begin(itemId: string): Promise<void>;
  complete(itemId: string, text: string, at: number): Promise<void>;
  fail(itemId: string): Promise<void>;
  changed(): Promise<void>;
  waitUntil(task: Promise<unknown>): void;
};

export class AssistantPlayback {
  private items = new Map<string, Item>();
  private playing = new Set<string>();
  private generating = false;
  private pending = new Map<string, Pending>();
  constructor(private socket: WebSocket, private transcribe: (audio: string) => Promise<string>, private hooks: Hooks) {}
  interrupted(itemId: string) { return this.pending.has(itemId); }
  private begin(itemId: string): Pending {
    const existing = this.pending.get(itemId);
    if (existing) return existing;
    const pending: Pending = { begin: this.hooks.begin(itemId), timer: setTimeout(() => this.fail(itemId), 5000), requested: false, received: false, at: this.items.get(itemId)?.at ?? Date.now() };
    this.pending.set(itemId, pending);
    pending.begin.catch(() => this.fail(itemId));
    return pending;
  }
  private fail(itemId: string) {
    const pending = this.pending.get(itemId);
    if (!pending || pending.received) return;
    pending.received = true; pending.audio = undefined; clearTimeout(pending.timer);
    this.hooks.waitUntil(pending.begin.then(() => this.hooks.fail(itemId)).catch(() => {}).finally(() => this.hooks.changed()));
  }
  private request(itemId: string) {
    const pending = this.begin(itemId);
    if (pending.requested || pending.received) return;
    pending.requested = true;
    try { this.socket.send(JSON.stringify({ type: "conversation.item.retrieve", item_id: itemId })); }
    catch { this.fail(itemId); }
  }
  private transcribePrefix(itemId: string) {
    const pending = this.pending.get(itemId);
    if (!pending?.audio || pending.audioEndMs === undefined || pending.received) return;
    const end = pending.audioEndMs * 64;
    if (pending.audio.length < end) { this.fail(itemId); return; }
    const audio = pending.audio.slice(0, end);
    pending.audio = undefined; pending.received = true; clearTimeout(pending.timer);
    this.hooks.waitUntil(pending.begin.then(async () => {
      try { await this.hooks.complete(itemId, await this.transcribe(audio), pending.at); }
      catch { await this.hooks.fail(itemId); }
    }).catch(() => {}).finally(() => this.hooks.changed()));
  }
  observe(event: Record<string, unknown>): boolean {
    const responseId = typeof event.response_id === "string" ? event.response_id : "";
    const itemId = typeof event.item_id === "string" ? event.item_id : "";
    if (event.type === "response.created") this.generating = true;
    if (event.type === "response.done") this.generating = false;
    if (event.type === "response.output_item.added") {
      const item = event.item as { id?: unknown; role?: unknown } | undefined;
      if (item?.role === "assistant" && typeof item.id === "string") this.items.set(item.id, { responseId, at: Date.now() });
    }
    if (event.type === "output_audio_buffer.started") this.playing.add(responseId);
    if (event.type === "output_audio_buffer.cleared") {
      for (const [id, item] of this.items) if (!responseId || item.responseId === responseId) this.request(id);
      if (responseId) this.playing.delete(responseId); else this.playing.clear();
    }
    if (event.type === "output_audio_buffer.stopped") {
      this.playing.delete(responseId);
      for (const [id, item] of this.items) if (item.responseId === responseId && !this.interrupted(id)) this.items.delete(id);
    }
    if (event.type === "conversation.item.truncated" && itemId) {
      const pending = this.begin(itemId);
      if (pending.received) return false;
      if (!Number.isSafeInteger(event.audio_end_ms) || Number(event.audio_end_ms) < 0 || Number(event.audio_end_ms) > 300000 || event.content_index !== 0) { this.fail(itemId); return false; }
      pending.audioEndMs = Number(event.audio_end_ms);
      if (pending.audioEndMs === 0) {
        pending.received = true; pending.audio = undefined; clearTimeout(pending.timer);
        this.hooks.waitUntil(pending.begin.then(() => this.hooks.complete(itemId, "", pending.at)).catch(() => {}).finally(() => this.hooks.changed()));
      } else {
        this.request(itemId); this.transcribePrefix(itemId);
      }
    }
    if (event.type !== "conversation.item.retrieved") return false;
    const item = event.item as { id?: unknown; role?: unknown; content?: Array<{ type?: unknown; audio?: unknown }> } | undefined;
    if (typeof item?.id !== "string") return true;
    const pending = this.pending.get(item.id);
    if (!pending?.requested || pending.received) return true;
    const part = item.content?.find(part => part.type === "output_audio");
    const audio = part?.audio;
    const bytes = typeof audio === "string" ? audio.length / 4 * 3 - (audio.endsWith("==") ? 2 : audio.endsWith("=") ? 1 : 0) : 0;
    if (item.role !== "assistant" || typeof audio !== "string" || audio.length > MAX_ASSISTANT_AUDIO_CHARS || audio.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio) || bytes <= 0 || bytes % 2 !== 0) { this.fail(item.id); return true; }
    pending.audio = audio;
    this.transcribePrefix(item.id);
    return true;
  }
  prepareEnd() {
    const active = [...this.items].filter(([, item]) => this.playing.has(item.responseId));
    for (const [id] of active) this.begin(id);
    if (active.length) {
      try {
        if (this.generating) this.socket.send(JSON.stringify({ type: "response.cancel" }));
        this.socket.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
        for (const [id] of active) this.request(id);
      } catch { for (const [id] of active) this.fail(id); }
    }
  }
  close() { for (const [id, pending] of this.pending) if (!pending.received) this.fail(id); }
}
