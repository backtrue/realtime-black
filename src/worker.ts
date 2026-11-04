import { DurableObject } from "cloudflare:workers";
import { AppError, type CallRecord, type EccalPort, type Identity, type DocumentKind, type Store, type TranscriptLine, type ConfirmedEnd, type DeliveryPort, type DeliveryJob } from "./contracts";
import { MemberEngine } from "./member-engine";
import { ThinkWithBlackMcp } from "./mcp";
import { OpenAiRealtime, OpenAiDocuments } from "./openai";
import { boundedEccal } from "./eccal";
import { boundedDelivery } from "./delivery";
import { callDeadline } from "./metering";
import { HttpEccalQuota } from "./eccal-http";
import { authRoutes, type AuthorizationPort } from './auth-routes';
import { MemberAuthorization } from './member-authorization';
import { McpOAuth } from './mcp-oauth';

export interface Env {
  ASSETS: Fetcher;
  MEMBERS: DurableObjectNamespace<MemberRoom>;
  CUTOFFS: DurableObjectNamespace<CallCutoff>;
  AUTH: DurableObjectNamespace<AuthVault>;
  AUTH_VAULT_KEY?: string;
  MCP_CLIENT_ID?: string;
  ECCAL?: EccalPort;
  ECCAL_ORIGIN?: string;
  ECCAL_SERVICE_TOKEN?: string;
  DELIVERY?: DeliveryPort;
  OPENAI_API_KEY?: string;
  REALTIME_MODEL?: string;
  TEXT_MODEL?: string;
  APP_ORIGIN?: string;
}

const missingEccal: EccalPort = {
  authenticate: async () => { throw new AppError("ECCAL_NOT_CONFIGURED"); },
  balance: async () => { throw new AppError("ECCAL_NOT_CONFIGURED"); },
  reserve: async () => { throw new AppError("ECCAL_NOT_CONFIGURED"); },
  settle: async () => { throw new AppError("ECCAL_NOT_CONFIGURED"); },
  mcpGrant: async () => { throw new AppError("ECCAL_NOT_CONFIGURED"); },
};

function eccalPort(env: Env): EccalPort {
  if (env.ECCAL) return env.ECCAL;
  if (!env.ECCAL_ORIGIN && !env.ECCAL_SERVICE_TOKEN) return missingEccal;
  const quota = new HttpEccalQuota(env.ECCAL_ORIGIN ?? '', env.ECCAL_SERVICE_TOKEN ?? '');
  return {
    authenticate: credentials => quota.authenticate(credentials), balance: id => quota.balance(id),
    reserve: (id, operation) => quota.reserve(id, operation), settle: (id, reservation, events) => quota.settle(id, reservation, events),
    mcpGrant: async memberId => {
      if (!env.AUTH) throw new AppError('MCP_AUTH_NOT_CONFIGURED');
      return unwrap(await env.AUTH.get(env.AUTH.idFromName(await memberKey(memberId))).grant(memberId));
    },
  };
}

type RpcResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };
function unwrap<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new AppError(result.error, result.status);
  return result.value;
}
export class AuthVault extends DurableObject<Env> {
  private authorization: MemberAuthorization;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const store: Store = { get: key => ctx.storage.get(key), put: (key, value) => ctx.storage.put(key, value), delete: async key => { await ctx.storage.delete(key); }, list: prefix => ctx.storage.list({ prefix }), alarm: at => ctx.storage.setAlarm(at) };
    const mcp = new ThinkWithBlackMcp();
    this.authorization = new MemberAuthorization({ store, secret: env.AUTH_VAULT_KEY, oauth: new McpOAuth(env.APP_ORIGIN ?? '', env.MCP_CLIENT_ID), mcp, account: grant => mcp.account(grant), verifyAccount: (id, email) => new HttpEccalQuota(env.ECCAL_ORIGIN ?? '', env.ECCAL_SERVICE_TOKEN ?? '').verifyMcpAccount(id, email) });
  }
  private run<T>(action: () => Promise<T>): Promise<RpcResult<T>> {
    const result: Promise<RpcResult<T>> = this.queue.then(async () => { try { return { ok: true, value: await action() }; } catch (error) { return { ok: false, error: error instanceof AppError ? error.code : 'AUTH_UNAVAILABLE', status: error instanceof AppError ? error.status : 503 }; } });
    this.queue = result; return result;
  }
  begin(id: string, session: string, browser: string) { return this.run(() => this.authorization.begin(id, session, browser)); }
  complete(id: string, session: string, browser: string, input: { state: string; code?: string; error?: string; issuer?: string }) { return this.run(() => this.authorization.complete(id, session, browser, input)); }
  grant(id: string) { return this.run(() => this.authorization.grant(id)); }
  list(id: string, authorizationId: string) { return this.run(() => this.authorization.list(id, authorizationId)); }
  call(id: string, authorizationId: string, name: string, args: Record<string, unknown>) { return this.run(() => this.authorization.call(id, authorizationId, name, args)); }
  revoke(id: string) { return this.run(() => this.authorization.revoke(id)); }
  async alarm() { const result = await this.run(() => this.authorization.alarm()); if (!result.ok) throw new Error(result.error); }
}
type CutoffState = { memberId: string; recordId: string; callId: string; deadline: number; endedAt?: number; closing?: boolean; meterRevision?: number };
export class CallCutoff extends DurableObject<Env> {
  async arm(state: CutoffState) {
    await this.ctx.storage.put("call", state);
    await this.ctx.storage.setAlarm(state.deadline);
  }
  async updateDeadline(deadline: number, meterRevision: number): Promise<RpcResult<{ updated: boolean }>> {
    const state = await this.ctx.storage.get<CutoffState>("call");
    if (!state || state.closing || state.endedAt !== undefined) return { ok: false, error: "CALL_ENDED", status: 409 };
    if (!Number.isSafeInteger(deadline) || !Number.isSafeInteger(meterRevision)) return { ok: false, error: "METER_EVENTS_INVALID", status: 503 };
    if (meterRevision < (state.meterRevision ?? 0)) return { ok: true, value: { updated: false } };
    state.deadline = deadline;
    state.meterRevision = meterRevision;
    await this.ctx.storage.put("call", state);
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, deadline));
    return { ok: true, value: { updated: true } };
  }
  async cancel() {
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    let state = await this.ctx.storage.get<CutoffState>("call");
    if (!state) return;
    if (!state.closing && state.deadline > Date.now()) { await this.ctx.storage.setAlarm(state.deadline); return; }
    const member = this.env.MEMBERS.get(this.env.MEMBERS.idFromName(await memberKey(state.memberId)));
    if (!state.closing) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let proof: Awaited<ReturnType<typeof member.meterProof>> = null;
      try { proof = await Promise.race([member.meterProof(state.memberId, state.recordId), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1000); })]); }
      catch { /* 無法取得更新時仍執行已安排的截止 */ }
      finally { clearTimeout(timer); }
      state = await this.ctx.storage.get<CutoffState>("call");
      if (!state) return;
      if (proof && proof.revision > (state.meterRevision ?? 0)) { state.deadline = proof.deadline; state.meterRevision = proof.revision; }
      if (state.deadline > Date.now()) {
        await this.ctx.storage.put("call", state);
        await this.ctx.storage.setAlarm(state.deadline);
        return;
      }
    }
    state.closing = true;
    await this.ctx.storage.put("call", state);
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    if (state.endedAt === undefined) {
      try {
        await new OpenAiRealtime(this.env.OPENAI_API_KEY ?? "", this.env.REALTIME_MODEL ?? "").hangup(state.callId);
        state.endedAt = Date.now();
      } catch (error) {
        const proof = await member.endProof(state.recordId);
        if (proof === null) throw error;
        state.endedAt = proof;
      }
      await this.ctx.storage.put("call", state);
    }
    const result = await member.providerEnded(state.memberId, state.recordId, state.endedAt);
    if (!result.ok) { await this.ctx.storage.setAlarm(Date.now() + 1000); return; }
    await this.cancel();
  }
}

function publicRecord(record: CallRecord) {
  return { id: record.id, status: record.status, createdAt: record.createdAt, endedAt: record.endedAt, expiresAt: record.expiresAt, transcript: record.transcript, documents: record.documents.filter(document => document.sourceRevision === (record.transcriptRevision ?? 0)), deliveries: (record.deliveries ?? []).map(publicDelivery), settlement: record.settlement, pendingTranscripts: record.pendingTranscripts?.length ?? 0, transcriptionFailures: record.transcriptionFailures?.length ?? 0 };
}
function publicDelivery(job: DeliveryJob) { return { id: job.id, documentId: job.documentId, channel: job.channel, state: job.state, createdAt: job.createdAt, failureCode: job.failureCode }; }

export class MemberRoom extends DurableObject<Env> {
  private engine: MemberEngine;
  private sockets = new Map<string, WebSocket>();
  private pendingSpeech = new Map<string, Map<string, TranscriptLine[]>>();
  private drains = new Map<string, { timer: ReturnType<typeof setTimeout>; resolve: () => void }>();
  private queue: Promise<unknown> = Promise.resolve();
  private run<T>(operation: () => Promise<T>): Promise<RpcResult<T>> {
    const result: Promise<RpcResult<T>> = this.queue.then(async () => {
      try { return { ok: true, value: await operation() }; }
      catch (error) {
        return { ok: false, error: error instanceof AppError ? error.code : "SERVICE_UNAVAILABLE", status: error instanceof AppError ? error.status : 503 };
      }
    });
    this.queue = result;
    return result;
  }
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const store: Store = {
      get: key => ctx.storage.get(key), put: (key, value) => ctx.storage.put(key, value),
      delete: async key => { await ctx.storage.delete(key); },
      list: prefix => ctx.storage.list({ prefix }),
      alarm: at => ctx.storage.setAlarm(at),
    };
    this.engine = new MemberEngine({
      store, eccal: boundedEccal(eccalPort(env)),
      realtime: new OpenAiRealtime(env.OPENAI_API_KEY ?? "", env.REALTIME_MODEL ?? ""),
      mcp: {
        list: async grant => grant.authorizationId ? unwrap(await env.AUTH.get(env.AUTH.idFromName(await memberKey(grant.memberId))).list(grant.memberId, grant.authorizationId)) : new ThinkWithBlackMcp().list(grant),
        call: async (grant, name, args) => grant.authorizationId ? unwrap(await env.AUTH.get(env.AUTH.idFromName(await memberKey(grant.memberId))).call(grant.memberId, grant.authorizationId, name, args)) : new ThinkWithBlackMcp().call(grant, name, args),
      }, documents: new OpenAiDocuments(env.OPENAI_API_KEY ?? "", env.TEXT_MODEL ?? ""),
      onMeterChange: async record => { unwrap(await env.CUTOFFS.get(env.CUTOFFS.idFromName(record.id)).updateDeadline(callDeadline(record, Date.now()), record.events.length)); },
      now: Date.now, id: () => crypto.randomUUID(),
      delivery: env.DELIVERY ? boundedDelivery(env.DELIVERY) : undefined, appOrigin: env.APP_ORIGIN,
    });
  }
  async start(identity: Identity, operationId: string, sdp: string) {
    return this.run(async () => {
      const call = await this.engine.start(identity, operationId, sdp);
      try {
        await this.env.CUTOFFS.get(this.env.CUTOFFS.idFromName(call.id)).arm({ memberId: identity.memberId, recordId: call.id, callId: call.callId, deadline: call.deadline, meterRevision: 1 });
        await this.attach(identity.memberId, call.id, call.callId);
        if (Date.now() >= call.deadline) throw new AppError("QUOTA_EXHAUSTED", 403);
        await this.engine.activate(identity.memberId, call.id);
      }
      catch {
        await this.engine.end(identity.memberId, call.id);
        throw new AppError("CALL_CONTROL_UNAVAILABLE", 502);
      }
      return { id: call.id, sdp: call.sdp, deadline: call.deadline };
    });
  }
  async stop(memberId: string, id: string) {
    return this.run(async () => {
      const record = await this.engine.end(memberId, id);
      await this.env.CUTOFFS.get(this.env.CUTOFFS.idFromName(id)).cancel();
      this.finish(memberId, record);
      return publicRecord(record);
    });
  }
  async record(memberId: string, id: string) {
    return this.run(async () => publicRecord(await this.engine.get(memberId, id)));
  }
  async records(memberId: string) {
    return this.run(async () => (await this.engine.list(memberId)).map(publicRecord));
  }
  async document(memberId: string, id: string, kind: DocumentKind) {
    return this.run(() => this.engine.document(memberId, id, kind));
  }
  async requestDelivery(memberId: string, id: string, input: { documentId: string; channel: "email" | "line"; recipient: string; operationId: string }) {
    return this.run(async () => {
      const created = await this.engine.requestDelivery(memberId, id, input);
      return { job: publicDelivery(created.job), claimCode: created.claimCode };
    });
  }
  async dispatchDelivery(memberId: string, id: string, jobId: string, proof: unknown, claimCode?: string) {
    return this.run(async () => publicDelivery(await this.engine.dispatchDelivery(memberId, id, jobId, proof, claimCode)));
  }
  async providerEnded(memberId: string, id: string, at: number): Promise<RpcResult<{ acknowledged: true }>> {
    const record = await this.ctx.storage.get<CallRecord>(`call:${id}`);
    if (!record || record.memberId !== memberId) return { ok: false, error: "RECORD_NOT_FOUND", status: 404 };
    const existing = await this.ctx.storage.get<ConfirmedEnd>(`provider-end:${id}`);
    await this.ctx.storage.put(`provider-end:${id}`, existing ?? { memberId, recordId: id, at });
    await this.ctx.storage.setAlarm(Date.now() + 1);
    return { ok: true, value: { acknowledged: true } };
  }
  async endProof(id: string) {
    const notification = await this.ctx.storage.get<ConfirmedEnd>(`provider-end:${id}`);
    if (notification) return notification.at;
    const record = await this.ctx.storage.get<CallRecord>(`call:${id}`);
    return record?.endedAt ?? null;
  }
  async meterProof(memberId: string, id: string) {
    const record = await this.ctx.storage.get<CallRecord>(`call:${id}`);
    if (!record || record.memberId !== memberId || record.status !== "active") return null;
    return { deadline: callDeadline(record, Date.now()), revision: record.events.length };
  }
  private async generateSummary(memberId: string, id: string) {
    try {
      await this.run(async () => {
        const record = await this.engine.get(memberId, id);
        if (record.settlement && record.transcript.length && !(record.pendingTranscripts ?? []).length && !record.documents.some(document => document.kind === "summary" && document.sourceRevision === (record.transcriptRevision ?? 0))) await this.engine.document(memberId, id, "summary");
      });
    } catch { /* 會員可在紀錄頁重新產生摘要 */ }
  }
  private finish(memberId: string, record: CallRecord) {
    const existing = this.drains.get(record.id);
    if (existing) { if (!record.pendingTranscripts?.length) existing.resolve(); return; }
    let resolve!: () => void;
    let timedOut = false;
    const drained = new Promise<void>(done => { resolve = done; });
    const timer = setTimeout(() => { timedOut = true; resolve(); }, 10000);
    this.drains.set(record.id, { timer, resolve });
    if (!record.pendingTranscripts?.length) resolve();
    this.ctx.waitUntil(drained.then(async () => {
      clearTimeout(timer);
      if (timedOut) await this.run(() => this.engine.failPendingTranscripts(memberId, record.id));
      this.sockets.get(record.id)?.close(1000, "ended");
      this.sockets.delete(record.id);
      this.pendingSpeech.delete(record.id);
      await this.generateSummary(memberId, record.id);
      this.drains.delete(record.id);
    }));
  }
  async alarm() {
    await this.run(() => this.engine.alarm());
    for (const record of (await this.ctx.storage.list<CallRecord>({ prefix: "call:" })).values()) {
      if (record.endedAt !== undefined && this.sockets.has(record.id)) this.finish(record.memberId, record);
      if (record.settlement) this.ctx.waitUntil(this.generateSummary(record.memberId, record.id));
    }
  }
  private async attach(memberId: string, id: string, callId: string) {
    const response = await fetch(`https://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`, {
      headers: { Upgrade: "websocket", authorization: `Bearer ${this.env.OPENAI_API_KEY}` }, redirect: "manual", signal: AbortSignal.timeout(5000),
    });
    const socket = response.webSocket;
    if (!socket) throw new AppError("CALL_CONTROL_UNAVAILABLE", 502);
    socket.accept();
    this.sockets.set(id, socket);
    this.pendingSpeech.set(id, new Map());
    socket.addEventListener("message", message => {
      this.ctx.waitUntil(this.run(async () => {
        if (typeof message.data !== "string" || message.data.length > 1024 * 1024) return;
        const event = JSON.parse(message.data) as Record<string, unknown>;
        await this.engine.ingest(memberId, id, event);
        const responseId = typeof event.response_id === "string" ? event.response_id : "";
        const pending = this.pendingSpeech.get(id);
        if (event.type === "response.output_audio_transcript.done" && typeof event.transcript === "string" && typeof event.item_id === "string") {
          const lines = pending?.get(responseId) ?? [];
          if (!lines.some(line => line.itemId === event.item_id)) lines.push({ itemId: event.item_id, role: "assistant", text: event.transcript, at: Date.now() });
          pending?.set(responseId, lines);
        }
        if (event.type === "output_audio_buffer.cleared") {
          if (responseId) pending?.delete(responseId); else pending?.clear();
        }
        if (event.type === "output_audio_buffer.stopped") {
          for (const line of pending?.get(responseId) ?? []) await this.engine.assistantPlayed(memberId, id, line);
          pending?.delete(responseId);
        }
        if (["conversation.item.input_audio_transcription.completed", "conversation.item.input_audio_transcription.failed", "output_audio_buffer.stopped"].includes(String(event.type))) {
          const record = await this.engine.get(memberId, id);
          if (record.endedAt !== undefined) {
            this.finish(memberId, record);
            this.ctx.waitUntil(this.generateSummary(memberId, id));
          }
        }
        if (event.type === "response.function_call_arguments.done" && typeof event.call_id === "string" && typeof event.name === "string" && typeof event.arguments === "string") {
          const result = await this.engine.tool(memberId, id, event.call_id, event.name, event.arguments);
          if (!result.sent) {
            socket.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: event.call_id, output: result.output } }));
            socket.send(JSON.stringify({ type: "response.create" }));
            await this.engine.toolSent(memberId, id, event.call_id);
          }
        }
      }).then(async result => { if (!result.ok) await this.stop(memberId, id); }));
    });
    const closed = () => {
      if (this.drains.has(id)) return;
      this.ctx.waitUntil(this.stop(memberId, id).catch(() => {}));
    };
    socket.addEventListener("close", closed);
    socket.addEventListener("error", closed);
  }
}

async function member(request: Request, env: Env) {
  const identity = await boundedEccal(eccalPort(env)).authenticate({ cookie: request.headers.get("cookie") ?? "", authorization: request.headers.get("authorization") ?? "" });
  if (!identity || typeof identity.memberId !== "string" || !identity.memberId || identity.memberId.length > 256 || typeof identity.eligible !== "boolean") throw new AppError("LOGIN_REQUIRED", 401);
  return identity;
}
async function memberKey(memberId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(memberId));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function readText(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_REQUEST", 400);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new AppError("REQUEST_TOO_LARGE", 413); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(all); }
  catch { throw new AppError("INVALID_REQUEST", 400); }
}
const securityHeaders = {
  "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer",
  "permissions-policy": "microphone=(self), camera=()",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      const path = new URL(request.url).pathname;
      if (path.startsWith('/auth/') || path === '/oauth/client-metadata.json') response = await authRoutes(request, env, memberId => {
        if (!env.AUTH) throw new AppError('MCP_AUTH_NOT_CONFIGURED');
        const port = async () => env.AUTH.get(env.AUTH.idFromName(await memberKey(memberId)));
        return {
          begin: async (...args) => unwrap(await (await port()).begin(...args)),
          complete: async (...args) => unwrap(await (await port()).complete(...args)),
          grant: async id => unwrap(await (await port()).grant(id)), revoke: async id => unwrap(await (await port()).revoke(id)),
        } satisfies AuthorizationPort;
      });
      else if (!path.startsWith("/api/")) response = await env.ASSETS.fetch(request);
      else {
        if (!["GET", "POST"].includes(request.method)) throw new AppError("METHOD_NOT_ALLOWED", 405);
        if (request.method === "POST" && (!env.APP_ORIGIN || request.headers.get("origin") !== env.APP_ORIGIN)) throw new AppError("ORIGIN_FORBIDDEN", 403);
        const identity = await member(request, env);
        const room = env.MEMBERS.get(env.MEMBERS.idFromName(await memberKey(identity.memberId)));
        if (path === "/api/me" && request.method === "GET") {
          const seconds = await boundedEccal(eccalPort(env)).balance(identity.memberId);
          if (!Number.isSafeInteger(seconds) || seconds < 0) throw new AppError("BALANCE_INVALID");
          response = Response.json({ eligible: identity.eligible, remainingSeconds: seconds });
        } else if (path === "/api/calls" && request.method === "GET") response = Response.json(unwrap(await room.records(identity.memberId)));
        else if (path === "/api/calls" && request.method === "POST") {
          if (request.headers.get("content-type")?.split(";")[0] !== "application/sdp") throw new AppError("SDP_REQUIRED", 415);
          const operationId = request.headers.get("idempotency-key") ?? "";
          response = Response.json(unwrap(await room.start(identity, operationId, await readText(request, 65536))), { status: 201 });
        } else {
          const match = /^\/api\/calls\/([a-zA-Z0-9_-]{1,100})(?:\/(end|documents|deliveries))?$/.exec(path);
          if (!match?.[1]) throw new AppError("NOT_FOUND", 404);
          if (!match[2] && request.method === "GET") response = Response.json(unwrap(await room.record(identity.memberId, match[1])));
          else if (match[2] === "end" && request.method === "POST") response = Response.json(unwrap(await room.stop(identity.memberId, match[1])));
          else if (match[2] === "documents" && request.method === "POST") {
            const text = await readText(request, 1024);
            let data: { kind?: string };
            try { data = JSON.parse(text); } catch { throw new AppError("INVALID_REQUEST", 400); }
            if (!data || !["summary", "report", "copy", "plan"].includes(data.kind ?? "") || Object.keys(data).length !== 1) throw new AppError("DOCUMENT_KIND_INVALID", 400);
            response = Response.json(unwrap(await room.document(identity.memberId, match[1], data.kind as DocumentKind)), { status: 201 });
          } else if (match[2] === "deliveries" && request.method === "POST") {
            let data: unknown;
            try { data = JSON.parse(await readText(request, 2048)); } catch (error) { throw error instanceof AppError ? error : new AppError("INVALID_REQUEST", 400); }
            if (!data || typeof data !== "object" || Array.isArray(data)) throw new AppError("INVALID_DELIVERY_REQUEST", 400);
            const input = data as Record<string, unknown>;
            if (Object.keys(input).some(key => !["documentId", "channel", "recipient", "operationId"].includes(key)) || typeof input.documentId !== "string" || typeof input.operationId !== "string" || typeof input.recipient !== "string" || input.channel !== "email" && input.channel !== "line") throw new AppError("INVALID_DELIVERY_REQUEST", 400);
            response = Response.json(unwrap(await room.requestDelivery(identity.memberId, match[1], input as { documentId: string; channel: "email" | "line"; recipient: string; operationId: string })), { status: 201 });
          } else throw new AppError("METHOD_NOT_ALLOWED", 405);
        }
      }
    } catch (error) {
      const mapped = error instanceof AppError ? error : new AppError("SERVICE_UNAVAILABLE");
      response = Response.json({ error: mapped.code }, { status: mapped.status });
    }
    const result = new Response(response.body, response);
    for (const [key, value] of Object.entries(securityHeaders)) result.headers.set(key, value);
    result.headers.set("cache-control", "no-store");
    return result;
  },
} satisfies ExportedHandler<Env>;
