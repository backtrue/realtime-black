import { AppError, type CallRecord, type Dependencies, type Identity, type MeterEvent, type DocumentKind, type TranscriptLine, type Reservation, type Settlement, type ConfirmedEnd, type DeliveryJob } from "./contracts";
import { SHARED_METHOD_TOOLS } from "./default-methods";
import { sendDelivery } from "./delivery";
import { LINE_ACCOUNT, lineInput, type LinePrepare, type LineComplete } from './line-delivery';
import { billedSeconds, callDeadline } from "./metering";

const DAYS_30 = 30 * 24 * 60 * 60 * 1000;
type PendingReservation = { memberId: string; operationId: string; recordId: string; createdAt: number; balance: number };
type PendingSettlement = { memberId: string; recordId: string; reservationId: string; reservedSeconds: number; events: MeterEvent[] };
export class MemberEngine {
  constructor(private deps: Dependencies) {}
  private async save(record: CallRecord) {
    const links = new Map((record.itemOrder ?? []).map(item => [item.id, item.previousId]));
    const order = new Map<string, number>();
    const visiting = new Set<string>();
    const visit = (id: string) => {
      if (order.has(id) || visiting.has(id)) return;
      visiting.add(id);
      const previous = links.get(id);
      if (previous) visit(previous);
      order.set(id, order.size);
    };
    for (const id of links.keys()) visit(id);
    record.transcript.sort((a, b) => (order.get(a.itemId) ?? Infinity) - (order.get(b.itemId) ?? Infinity));
    await this.deps.store.put(`call:${record.id}`, record);
  }
  private invalidateDocuments(record: CallRecord) {
    record.documents = [];
    for (const job of record.deliveries ?? []) if (job.state === "pending") { job.state = "failed"; job.failureCode = "DOCUMENT_STALE"; }
    for (const job of record.deliveries ?? []) if (job.state === 'sending' && job.lineAttempt) { job.state = 'unknown'; job.failureCode = 'DOCUMENT_STALE'; }
  }
  private event(record: CallRecord, type: MeterEvent["type"], id = this.deps.id(), toolCallId?: string) {
    if (!record.events.some(event => event.id === id)) record.events.push({ id, type, at: this.deps.now(), ...(toolCallId ? { toolCallId } : {}) });
  }
  private async syncMeter(record: CallRecord) {
    await this.save(record);
    await this.schedule();
    await this.deps.onMeterChange?.(record);
  }
  private reservationValid(reservation: Reservation, pending: PendingReservation) {
    return reservation.memberId === pending.memberId && Boolean(reservation.id) && Number.isSafeInteger(reservation.seconds) && reservation.seconds > 0 && reservation.seconds <= pending.balance && Number.isSafeInteger(reservation.deadline);
  }
  private newRecord(pending: PendingReservation, reservation: Reservation): CallRecord {
    return { id: pending.recordId, memberId: pending.memberId, operationId: pending.operationId, reservation, status: "starting", events: [{ id: `reserved:${pending.operationId}`, type: "reserved", at: pending.createdAt }], transcript: [], itemOrder: [], pendingTranscripts: [], transcriptionFailures: [], transcriptRevision: 0, tools: [], toolResults: {}, createdAt: pending.createdAt, documents: [], deliveries: [] };
  }
  private async recoverReservation() {
    const pending = await this.deps.store.get<PendingReservation>("pending-reservation");
    if (!pending) return;
    let record = await this.deps.store.get<CallRecord>(`call:${pending.recordId}`);
    if (!record) {
      const reservation = await this.deps.eccal.reserve(pending.memberId, pending.operationId);
      if (!this.reservationValid(reservation, pending)) throw new AppError("RESERVATION_INVALID");
      record = this.newRecord(pending, reservation);
      record.status = "ending";
      await this.save(record);
    }
    await this.deps.store.put("active", record.id);
    await this.deps.store.delete("pending-reservation");
    await this.end(record.memberId, record.id);
  }
  private async queueSettlement(record: CallRecord): Promise<PendingSettlement> {
    const pending = { memberId: record.memberId, recordId: record.id, reservationId: record.reservation.id, reservedSeconds: record.reservation.seconds, events: record.events };
    await this.deps.store.put(`settlement:${record.id}`, pending);
    return pending;
  }
  private async settle(pending: PendingSettlement): Promise<Settlement> {
    const result = await this.deps.eccal.settle(pending.memberId, pending.reservationId, pending.events);
    if (result.billedSeconds !== billedSeconds(pending.events, pending.reservedSeconds) || !Number.isSafeInteger(result.remainingSeconds) || result.remainingSeconds < 0) throw new AppError("SETTLEMENT_INVALID");
    const record = await this.deps.store.get<CallRecord>(`call:${pending.recordId}`);
    if (record && (record.expiresAt === undefined || record.expiresAt > this.deps.now())) {
      record.settlement = result;
      record.status = record.callId && record.events.some(event => event.type === "connected") ? "ended" : "failed";
      await this.save(record);
    } else if (record) await this.deps.store.delete(`call:${record.id}`);
    if (await this.deps.store.get<string>("active") === pending.recordId) await this.deps.store.delete("active");
    await this.deps.store.delete(`settlement:${pending.recordId}`);
    return result;
  }
  async start(identity: Identity, operationId: string, sdp: string) {
    if (!identity.eligible) throw new AppError("MEMBER_INELIGIBLE", 403);
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(operationId) || !sdp.startsWith("v=0") || sdp.length > 65536) throw new AppError("INVALID_CALL_REQUEST", 400);
    if (await this.deps.store.get(`operation:${operationId}`)) throw new AppError("OPERATION_REPLAYED", 409);
    if (await this.deps.store.get("pending-reservation")) throw new AppError("RESERVATION_PENDING", 409);
    if ((await this.deps.store.list("settlement:")).size) throw new AppError("SETTLEMENT_PENDING", 409);
    const activeId = await this.deps.store.get<string>("active");
    if (activeId) {
      const active = await this.deps.store.get<CallRecord>(`call:${activeId}`);
      if (active && !["ended", "failed"].includes(active.status)) throw new AppError("CALL_ALREADY_ACTIVE", 409);
    }
    const balance = await this.deps.eccal.balance(identity.memberId);
    if (!Number.isSafeInteger(balance) || balance < 0) throw new AppError("BALANCE_INVALID");
    if (balance === 0) throw new AppError("QUOTA_EXHAUSTED", 403);
    const tools = await this.deps.mcp.list();
    if (!tools.length || tools.some(tool => !SHARED_METHOD_TOOLS.some(name => name === tool.name))) throw new AppError("MCP_TOOL_LIST_INVALID", 502);
    // 先保存操作識別值，未確定的 reserve 重送交由同一 id 對帳
    await this.deps.store.put(`operation:${operationId}`, { memberId: identity.memberId });
    const pending: PendingReservation = { memberId: identity.memberId, operationId, recordId: this.deps.id(), createdAt: this.deps.now(), balance };
    await this.deps.store.put("pending-reservation", pending);
    await this.deps.store.alarm(this.deps.now() + 1000);
    const reservation = await this.deps.eccal.reserve(identity.memberId, operationId);
    if (!this.reservationValid(reservation, pending) || reservation.deadline <= this.deps.now()) throw new AppError("RESERVATION_INVALID");
    const record = this.newRecord(pending, reservation);
    await this.save(record);
    await this.deps.store.put("active", record.id);
    await this.deps.store.delete("pending-reservation");
    let callId: string | undefined;
    try {
      const created = await this.deps.realtime.create(sdp, tools);
      callId = created.callId;
      record.callId = callId;
      await this.save(record);
      if (this.deps.now() >= reservation.deadline) {
        await this.end(identity.memberId, record.id);
        throw new AppError("QUOTA_EXHAUSTED", 403);
      }
      return { id: record.id, sdp: created.sdp, deadline: reservation.deadline, callId };
    } catch (error) {
      record.callId = callId;
      record.status = "ending";
      await this.save(record);
      await this.deps.store.alarm(this.deps.now() + 1000);
      try { await this.end(identity.memberId, record.id); } catch { /* alarm 續做掛斷及結算 */ }
      throw error instanceof AppError ? error : new AppError("CALL_START_FAILED", 502);
    }
  }
  async activate(memberId: string, id: string) {
    const record = await this.get(memberId, id);
    if (record.status !== "starting" || !record.callId || record.reservation.deadline <= this.deps.now()) throw new AppError("CALL_NOT_READY", 409);
    record.status = "active";
    await this.save(record);
    await this.deps.store.alarm(record.reservation.deadline);
  }
  async get(memberId: string, id: string): Promise<CallRecord> {
    const record = await this.deps.store.get<CallRecord>(`call:${id}`);
    if (!record || record.memberId !== memberId) throw new AppError("RECORD_NOT_FOUND", 404);
    if (record.expiresAt !== undefined && record.expiresAt <= this.deps.now()) {
      if (!record.settlement && record.endedAt !== undefined) await this.queueSettlement(record);
      await this.deps.store.delete(`call:${id}`);
      throw new AppError("RECORD_NOT_FOUND", 404);
    }
    return record;
  }
  async list(memberId: string) {
    const records = await this.deps.store.list<CallRecord>("call:");
    const result: CallRecord[] = [];
    for (const [key, record] of records) {
      if (record.expiresAt !== undefined && record.expiresAt <= this.deps.now()) {
        if (!record.settlement && record.endedAt !== undefined) await this.queueSettlement(record);
        await this.deps.store.delete(key);
      }
      else if (record.memberId === memberId) result.push(record);
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }
  async end(memberId: string, id: string) {
    const record = await this.get(memberId, id);
    if (record.settlement) return record;
    record.status = "ending";
    await this.save(record);
    await this.deps.store.alarm(this.deps.now() + 1000);
    if (record.endedAt === undefined) {
      if (record.callId) await this.deps.realtime.hangup(record.callId);
      record.endedAt = this.deps.now();
      record.expiresAt = record.endedAt + DAYS_30;
      this.event(record, "ended");
      await this.save(record);
    }
    await this.settle(await this.queueSettlement(record));
    await this.schedule();
    return this.get(memberId, id);
  }
  async providerEnded(memberId: string, id: string, at: number) {
    const record = await this.get(memberId, id);
    if (!record.settlement && record.endedAt === undefined) {
      record.endedAt = at;
      record.expiresAt = at + DAYS_30;
      record.status = "ending";
      if (!record.events.some(event => event.type === "ended")) record.events.push({ id: `provider-end:${id}`, type: "ended", at });
      await this.save(record);
    }
    if (!record.settlement) await this.queueSettlement(record);
    await this.schedule();
    return record;
  }
  async schedule() {
    const records = await this.deps.store.list<CallRecord>("call:");
    let next = await this.deps.store.get("pending-reservation") || (await this.deps.store.list("settlement:")).size || (await this.deps.store.list("provider-end:")).size ? this.deps.now() + 1000 : Infinity;
    for (const record of records.values()) {
      if (!record.settlement) next = Math.min(next, record.status === "ending" ? this.deps.now() + 1000 : callDeadline(record, this.deps.now()));
      if (record.expiresAt !== undefined) next = Math.min(next, record.expiresAt);
    }
    if (Number.isFinite(next)) await this.deps.store.alarm(Math.max(this.deps.now() + 1, next));
  }
  async alarm() {
    try { await this.recoverReservation(); } catch { /* 使用原操作識別值對帳，不另占用額度 */ }
    for (const [key, ended] of await this.deps.store.list<ConfirmedEnd>("provider-end:")) {
      if (!await this.deps.store.get(`call:${ended.recordId}`)) { await this.deps.store.delete(key); continue; }
      try { await this.providerEnded(ended.memberId, ended.recordId, ended.at); await this.deps.store.delete(key); }
      catch { /* 留下提供者確認結果，下一次 alarm 再處理 */ }
    }
    for (const pending of (await this.deps.store.list<PendingSettlement>("settlement:")).values()) {
      try { await this.settle(pending); } catch { /* 對帳資料不包含逐字稿及成果，可與正文期限分開處理 */ }
    }
    const records = await this.deps.store.list<CallRecord>("call:");
    for (const [key, record] of records) {
      if ((record.deliveries ?? []).some(job => job.state === "sending" && !job.lineAttempt)) {
        for (const job of record.deliveries) if (job.state === "sending" && !job.lineAttempt) job.state = "unknown";
        await this.save(record);
      }
      if (record.expiresAt !== undefined && record.expiresAt <= this.deps.now()) {
        if (!record.settlement && record.endedAt !== undefined) await this.queueSettlement(record);
        await this.deps.store.delete(key);
      } else if (!record.settlement && record.endedAt !== undefined && await this.deps.store.get(`settlement:${record.id}`)) {
        continue;
      } else if (!record.settlement && (record.status === "ending" || record.status === "starting" || callDeadline(record, this.deps.now()) <= this.deps.now())) {
        try { await this.end(record.memberId, record.id); } catch { /* 保留會話與額度占用，下一次 alarm 對帳 */ }
      }
    }
    await this.schedule();
  }
  async ingest(memberId: string, id: string, event: Record<string, unknown>) {
    const record = await this.get(memberId, id);
    if (record.status === "failed" || record.status === "starting") return;
    const eventId = typeof event.event_id === "string" ? event.event_id : this.deps.id();
    record.pendingTranscripts ??= [];
    record.transcriptionFailures ??= [];
    if (["input_audio_buffer.speech_started", "input_audio_buffer.committed"].includes(String(event.type)) && typeof event.item_id === "string" && !record.transcript.some(line => line.itemId === event.item_id) && !record.transcriptionFailures.includes(event.item_id) && !record.pendingTranscripts.includes(event.item_id)) record.pendingTranscripts.push(event.item_id);
    if (record.status === "active" && ["input_audio_buffer.speech_started", "output_audio_buffer.started"].includes(String(event.type)) && !record.events.some(event => event.type === "connected")) {
      this.event(record, "connected", eventId);
      await this.syncMeter(record);
    }
    if (["conversation.item.added", "conversation.item.created", "conversation.item.done", "input_audio_buffer.committed"].includes(String(event.type))) {
      const item = event.item as { id?: unknown } | undefined;
      const itemId = typeof item?.id === "string" ? item.id : typeof event.item_id === "string" ? event.item_id : undefined;
      if (itemId && (typeof event.previous_item_id === "string" || event.previous_item_id === null)) {
        record.itemOrder ??= [];
        const link = record.itemOrder.find(link => link.id === itemId);
        if (link) link.previousId = event.previous_item_id;
        else record.itemOrder.push({ id: itemId, previousId: event.previous_item_id });
      }
    }
    if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.item_id === "string" && typeof event.transcript === "string") {
      record.pendingTranscripts = record.pendingTranscripts.filter(id => id !== event.item_id);
      record.transcriptionFailures = record.transcriptionFailures.filter(id => id !== event.item_id);
      const line: TranscriptLine = { itemId: event.item_id, role: "user", text: event.transcript, at: this.deps.now() };
      if (!record.transcript.some(item => item.itemId === line.itemId)) {
        record.transcript.push(line);
        record.transcriptRevision = (record.transcriptRevision ?? 0) + 1;
        this.invalidateDocuments(record);
      }
    }
    if (event.type === "conversation.item.input_audio_transcription.failed" && typeof event.item_id === "string") {
      record.pendingTranscripts = record.pendingTranscripts.filter(id => id !== event.item_id);
      if (!record.transcriptionFailures.includes(event.item_id)) {
        record.transcriptionFailures.push(event.item_id);
        record.transcriptRevision = (record.transcriptRevision ?? 0) + 1;
        this.invalidateDocuments(record);
      }
    }
    await this.save(record);
  }
  async assistantPlayed(memberId: string, id: string, line: TranscriptLine) {
    const record = await this.get(memberId, id);
    if (record.status === "failed" || record.status === "starting" || record.transcript.some(item => item.itemId === line.itemId)) return;
    record.transcript.push(line);
    record.transcriptRevision = (record.transcriptRevision ?? 0) + 1;
    this.invalidateDocuments(record);
    await this.save(record);
  }
  async beginAssistantTranscript(memberId: string, id: string, itemId: string) {
    const record = await this.get(memberId, id);
    if (record.status === "failed" || record.status === "starting") return;
    record.pendingTranscripts ??= [];
    if (!record.pendingTranscripts.includes(itemId)) record.pendingTranscripts.push(itemId);
    if (record.transcript.some(line => line.itemId === itemId)) {
      record.transcript = record.transcript.filter(line => line.itemId !== itemId);
      record.transcriptRevision++; this.invalidateDocuments(record);
    }
    await this.save(record);
  }
  async finishAssistantTranscript(memberId: string, id: string, itemId: string, text: string | null, at: number) {
    const record = await this.get(memberId, id);
    record.pendingTranscripts = (record.pendingTranscripts ?? []).filter(id => id !== itemId);
    record.transcriptionFailures = (record.transcriptionFailures ?? []).filter(id => id !== itemId);
    record.transcript = record.transcript.filter(line => line.itemId !== itemId);
    if (text === null) record.transcriptionFailures.push(itemId);
    else if (text.trim()) record.transcript.push({ itemId, role: "assistant", text: text.trim(), at, interrupted: true });
    record.transcriptRevision++; this.invalidateDocuments(record);
    await this.save(record);
  }
  async failPendingTranscripts(memberId: string, id: string) {
    const record = await this.get(memberId, id);
    if (!(record.pendingTranscripts ?? []).length) return;
    record.transcriptionFailures = [...new Set([...(record.transcriptionFailures ?? []), ...record.pendingTranscripts])];
    record.pendingTranscripts = [];
    record.transcriptRevision = (record.transcriptRevision ?? 0) + 1;
    this.invalidateDocuments(record);
    await this.save(record);
  }
  async tool(memberId: string, id: string, callId: string, name: string, args: string) {
    const record = await this.get(memberId, id);
    if (record.status !== "active" || this.deps.now() >= callDeadline(record, this.deps.now())) throw new AppError("CALL_ENDED", 409);
    const existing = Object.hasOwn(record.toolResults, callId) ? record.toolResults[callId] : undefined;
    if (existing) return existing;
    let output: string;
    this.event(record, "tool_started", `tool-start:${callId}`, callId);
    await this.syncMeter(record);
    try {
      if (!SHARED_METHOD_TOOLS.some(tool => tool === name)) throw new AppError("TOOL_FORBIDDEN", 403);
      if (args.length > 16384) throw new AppError("TOOL_ARGUMENTS_INVALID", 400);
      const parsed = JSON.parse(args) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AppError("TOOL_ARGUMENTS_INVALID", 400);
      const result = await this.deps.mcp.call(name, parsed as Record<string, unknown>);
      output = JSON.stringify({ ok: true, result });
      record.tools.push({ id: callId, name, result });
    } catch {
      output = JSON.stringify({ ok: false, error: "未取得工具資料，請說明缺少的資訊，並與推論分開" });
    }
    this.event(record, "tool_finished", `tool-end:${callId}`, callId);
    Object.defineProperty(record.toolResults, callId, { value: { output, sent: false }, enumerable: true, writable: true, configurable: true });
    await this.syncMeter(record);
    return record.toolResults[callId]!;
  }
  async toolSent(memberId: string, id: string, callId: string) {
    const record = await this.get(memberId, id);
    if (Object.hasOwn(record.toolResults, callId)) record.toolResults[callId]!.sent = true;
    await this.save(record);
  }
  async document(memberId: string, id: string, kind: DocumentKind) {
    const record = await this.get(memberId, id);
    if (!record.settlement || !record.transcript.length) throw new AppError("CALL_NOT_READY", 409);
    if ((record.pendingTranscripts ?? []).length) throw new AppError("TRANSCRIPT_NOT_READY", 409);
    const generated = await this.deps.documents.generate(kind, record);
    await this.get(memberId, id);
    if ((record.transcriptionFailures ?? []).length) generated.findings.push({ kind: "unknown", text: `有 ${record.transcriptionFailures.length} 段語音未能辨識，這些片段未納入本次分析`, sourceIds: [] });
    const document = { ...generated, id: this.deps.id(), createdAt: this.deps.now(), sourceRevision: record.transcriptRevision ?? 0 };
    if (kind === "summary") record.documents = record.documents.filter(document => document.kind !== "summary");
    record.documents.push(document);
    await this.save(record);
    return document;
  }
  private async digest(value: string) {
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  async requestDelivery(memberId: string, id: string, input: { documentId: string; channel: "email" | "line"; recipient: string; operationId: string }) {
    const record = await this.get(memberId, id);
    if (!record.settlement || (record.pendingTranscripts ?? []).length) throw new AppError("CALL_NOT_READY", 409);
    const document = record.documents.find(document => document.id === input.documentId && document.sourceRevision === (record.transcriptRevision ?? 0));
    if (!document || document.kind === "summary") throw new AppError("DOCUMENT_NOT_FOUND", 404);
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(input.operationId) || !["email", "line"].includes(input.channel)) throw new AppError("INVALID_DELIVERY_REQUEST", 400);
    if (input.channel === "email" && (input.recipient.length > 320 || input.recipient !== "" && !/^[^\s@<>]+@[^\s@<>]+$/.test(input.recipient))) throw new AppError("RECIPIENT_INVALID", 400);
    if (input.channel === "line" && input.recipient !== "") throw new AppError("RECIPIENT_INVALID", 400);
    const fingerprint = await this.digest(JSON.stringify({ recordId: id, ...input }));
    const previous = record.deliveries?.find(job => job.operationId === input.operationId);
    if (previous) {
      if (previous.requestFingerprint !== fingerprint) throw new AppError("OPERATION_REPLAYED", 409);
      let claimCode: string | undefined;
      if (previous.channel === 'line' && previous.state === 'pending' && previous.claimVersion === 'derived-v1') {
        if (!this.deps.lineClaim) throw new AppError('LINE_NOT_CONFIGURED');
        claimCode = await this.deps.lineClaim(previous);
        if (await this.digest(claimCode) !== previous.claimDigest) throw new AppError('CLAIM_UNAVAILABLE', 409);
      }
      return { job: previous, claimCode };
    }
    if (input.channel === "email") {
      if (!this.deps.eccal.emailRecipient) throw new AppError("EMAIL_RECIPIENT_UNAVAILABLE");
      const recipient = await this.deps.eccal.emailRecipient(memberId);
      if (!recipient || recipient.length > 320 || !/^[^\s@<>]+@[^\s@<>]+$/.test(recipient)) throw new AppError("EMAIL_RECIPIENT_UNAVAILABLE");
      if (input.recipient !== "" && input.recipient !== recipient) throw new AppError("RECIPIENT_UNVERIFIED", 403);
      input = { ...input, recipient };
    }
    const job: DeliveryJob = { id: this.deps.id(), recordId: id, memberId, documentId: input.documentId, sourceRevision: record.transcriptRevision ?? 0, operationId: input.operationId, requestFingerprint: fingerprint, channel: input.channel, recipient: input.recipient, verifiedAt: null, state: "pending", createdAt: this.deps.now() };
    const claimCode = input.channel === 'line' ? await this.deps.lineClaim?.(job) : undefined;
    if (input.channel === 'line' && (!claimCode || !/^[a-f0-9]{32}$/.test(claimCode))) throw new AppError('LINE_NOT_CONFIGURED');
    if (claimCode) { job.claimDigest = await this.digest(claimCode); job.claimExpiresAt = record.expiresAt; job.claimVersion = 'derived-v1'; }
    if (input.channel === 'line') {
      if (!this.deps.registerLineDelivery || !record.expiresAt) throw new AppError('LINE_NOT_CONFIGURED');
      await this.deps.registerLineDelivery({ memberId, recordId: id, jobId: job.id, expiresAt: record.expiresAt });
    }
    record.deliveries ??= [];
    record.deliveries.push(job);
    await this.save(record);
    return { job, claimCode };
  }
  async lineTask(memberId: string, id: string, jobId: string) {
    const record = await this.get(memberId, id);
    const job = record.deliveries.find(job => job.id === jobId && job.channel === 'line');
    if (!job) throw new AppError('DELIVERY_NOT_FOUND', 404);
    const document = record.documents.find(document => document.id === job.documentId && document.sourceRevision === (record.transcriptRevision ?? 0));
    return { job, expiresAt: record.expiresAt!, documentTitle: document?.title ?? '內容已更新', currentDocument: !!document && job.sourceRevision === (record.transcriptRevision ?? 0) };
  }
  async prepareLine(memberId: string, id: string, input: LinePrepare) {
    lineInput('prepare', input);
    const record = await this.get(memberId, id);
    const { job, currentDocument } = await this.lineTask(memberId, id, input.jobId);
    if (!currentDocument) throw new AppError('DOCUMENT_STALE', 409);
    if (job.state !== 'pending' || job.lineAttempt) throw new AppError('DELIVERY_ALREADY_ATTEMPTED', 409);
    if (!job.claimDigest || job.claimExpiresAt === undefined || job.claimExpiresAt <= this.deps.now() || job.claimedAt !== undefined || await this.digest(input.claimCode) !== job.claimDigest) throw new AppError('CLAIM_INVALID', 403);
    job.recipient = input.chatRef; job.verifiedAt = this.deps.now(); job.state = 'sending';
    job.lineAttempt = { id: input.attemptId, officialAccount: LINE_ACCOUNT, chatRef: input.chatRef, preparedAt: this.deps.now() };
    record.deliveries[record.deliveries.findIndex(value => value.id === job.id)] = job;
    await this.save(record);
    return this.lineTask(memberId, id, job.id);
  }
  async completeLine(memberId: string, id: string, input: LineComplete) {
    lineInput('complete', input);
    const record = await this.get(memberId, id);
    const { job, currentDocument } = await this.lineTask(memberId, id, input.jobId);
    const attempt = job.lineAttempt;
    if (!attempt || attempt.id !== input.attemptId || attempt.chatRef !== input.chatRef || attempt.officialAccount !== input.officialAccount) throw new AppError('RECIPIENT_UNVERIFIED', 403);
    const fingerprint = await this.digest(JSON.stringify({ jobId: input.jobId, attemptId: input.attemptId, officialAccount: input.officialAccount, chatRef: input.chatRef, outcome: input.outcome, receipt: input.receipt, evidenceSha256: input.evidenceSha256 }));
    if (attempt.resultFingerprint) {
      if (attempt.resultFingerprint !== fingerprint) throw new AppError('DELIVERY_ALREADY_ATTEMPTED', 409);
      return this.lineTask(memberId, id, job.id);
    }
    if (!currentDocument) throw new AppError('DOCUMENT_STALE', 409);
    if (job.state !== 'sending') throw new AppError('DELIVERY_ALREADY_ATTEMPTED', 409);
    attempt.resultFingerprint = fingerprint;
    attempt.evidence = { outcome: input.outcome, receipt: input.receipt, evidenceSha256: input.evidenceSha256, observedAt: this.deps.now() };
    job.state = input.outcome === 'sent' ? 'succeeded' : input.outcome === 'rejected' ? 'failed' : 'unknown';
    if (input.outcome === 'sent') { job.providerReceipt = input.receipt; job.claimedAt = this.deps.now(); }
    record.deliveries[record.deliveries.findIndex(value => value.id === job.id)] = job;
    await this.save(record);
    return this.lineTask(memberId, id, job.id);
  }
  async dispatchDelivery(memberId: string, id: string, jobId: string, proof: unknown, claimCode?: string) {
    const record = await this.get(memberId, id);
    const job = record.deliveries?.find(job => job.id === jobId);
    if (!job) throw new AppError("DELIVERY_NOT_FOUND", 404);
    if (!record.documents.some(document => document.id === job.documentId && document.sourceRevision === (record.transcriptRevision ?? 0)) || job.sourceRevision !== (record.transcriptRevision ?? 0)) throw new AppError("DOCUMENT_STALE", 409);
    if (job.state !== "pending") throw new AppError("DELIVERY_ALREADY_ATTEMPTED", 409);
    if (!this.deps.delivery || !this.deps.appOrigin) throw new AppError("DELIVERY_NOT_CONFIGURED");
    if (job.channel === "email") {
      if (!this.deps.eccal.emailRecipient) throw new AppError("EMAIL_RECIPIENT_UNAVAILABLE");
      if (await this.deps.eccal.emailRecipient(memberId) !== job.recipient) throw new AppError("RECIPIENT_UNVERIFIED", 403);
    }
    if (job.channel === "line" && (!claimCode || !job.claimDigest || job.claimExpiresAt === undefined || job.claimExpiresAt <= this.deps.now() || job.claimedAt !== undefined || await this.digest(claimCode) !== job.claimDigest)) throw new AppError("CLAIM_INVALID", 403);
    const verified = await this.deps.delivery.verify(structuredClone(job), proof);
    if (verified.memberId !== memberId || verified.jobId !== job.id || verified.documentId !== job.documentId || typeof verified.recipient !== "string" || !verified.recipient || !Number.isSafeInteger(verified.verifiedAt) || verified.verifiedAt > this.deps.now() || verified.verifiedAt < job.createdAt || job.channel === "email" && verified.recipient !== job.recipient) throw new AppError("RECIPIENT_UNVERIFIED", 403);
    job.recipient = verified.recipient; job.verifiedAt = verified.verifiedAt;
    const origin = new URL(this.deps.appOrigin);
    if (origin.origin !== this.deps.appOrigin || !(origin.protocol === "https:" || origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname))) throw new AppError("DELIVERY_NOT_CONFIGURED");
    const resultUrl = new URL(`/#call=${encodeURIComponent(record.id)}&document=${encodeURIComponent(job.documentId)}`, origin).href;
    const sent = await sendDelivery(job, value => this.deps.delivery!.send(value as DeliveryJob, resultUrl), async () => {
      if (job.state === "sending") await this.deps.store.alarm(this.deps.now() + 1000);
      await this.save(record);
    }, verified.supervised === true);
    if (sent.state === "succeeded" && job.channel === "line") { job.claimedAt = this.deps.now(); await this.save(record); }
    return job;
  }
  async sendEmail(memberId: string, id: string, jobId: string) {
    const record = await this.get(memberId, id);
    const job = record.deliveries.find(job => job.id === jobId && job.channel === "email");
    if (!job) throw new AppError("DELIVERY_NOT_FOUND", 404);
    if (job.state !== "pending") return job;
    return this.dispatchDelivery(memberId, id, jobId, { kind: "member-email-request" });
  }
}
