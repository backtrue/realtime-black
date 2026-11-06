import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import worker, { type Env } from '../src/worker';
import { MemberEngine } from '../src/member-engine';
import { hash } from '../src/auth-crypto';
import { LINE_ACCOUNT, LineDeliveryIndex, type LinePrepare, type LineComplete } from '../src/line-delivery';
import { fixture, failure } from './fixture';
import { type Store, type CallRecord } from '../src/contracts';

async function prepareRecord(f = fixture(), engine = f.engine) {
  const call = await engine.start({ memberId: 'a', eligible: true }, crypto.randomUUID(), 'v=0\r\nfixture');
  await engine.activate('a', call.id);
  await engine.ingest('a', call.id, { type: 'input_audio_buffer.speech_started', item_id: 'question' });
  await engine.ingest('a', call.id, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'question', transcript: '請說明網站轉換率第一個查核數字' });
  await engine.end('a', call.id);
  const document = await engine.document('a', call.id, 'report');
  return { f, call, document, engine };
}
async function delivery() {
  const r = await prepareRecord();
  const created = await r.engine.requestDelivery('a', r.call.id, { documentId: r.document.id, channel: 'line', recipient: '', operationId: crypto.randomUUID() });
  const input: LinePrepare = { jobId: created.job.id, claimCode: created.claimCode!, observedChatRef: 'controlled-chat-a', chatRef: 'controlled-chat-a', attemptId: crypto.randomUUID(), officialAccount: LINE_ACCOUNT, supervised: true };
  const complete = (outcome: LineComplete['outcome'] = 'sent'): LineComplete => ({ jobId: input.jobId, attemptId: input.attemptId, chatRef: input.chatRef, officialAccount: LINE_ACCOUNT, outcome, receipt: 'controlled LINE UI receipt', evidenceSha256: 'a'.repeat(64) });
  return { ...r, created, input, complete };
}
describe('M2-10 LINE 真人監督交付', () => {
  it('ECCAL 登記失敗時不留下無法核對的會員工作', async () => {
    const r = await prepareRecord(); r.f.deps.registerLineDelivery = vi.fn(async () => { throw failure('ECCAL_UNAVAILABLE'); });
    await expect(r.engine.requestDelivery('a', r.call.id, { documentId: r.document.id, channel: 'line', recipient: '', operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'ECCAL_UNAVAILABLE' });
    expect((await r.f.record(r.call.id))!.deliveries).toHaveLength(0);
  });
  it('錯會員、錯碼、錯聊天室與錯官方帳號都不產生送出工作', async () => {
    const r = await delivery();
    await expect(r.engine.prepareLine('b', r.call.id, r.input)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await expect(r.engine.prepareLine('a', r.call.id, { ...r.input, claimCode: '0'.repeat(32) })).rejects.toMatchObject({ code: 'CLAIM_INVALID' });
    await expect(r.engine.prepareLine('a', r.call.id, { ...r.input, chatRef: 'wrong-chat' })).rejects.toMatchObject({ code: 'RECIPIENT_UNVERIFIED' });
    await expect(r.engine.prepareLine('a', r.call.id, { ...r.input, officialAccount: '@wrong' })).rejects.toMatchObject({ code: 'RECIPIENT_UNVERIFIED' });
    expect((await r.f.record(r.call.id))!.deliveries[0]!.state).toBe('pending');
    expect(r.f.realtime.create).toHaveBeenCalledTimes(1);
  });
  it('核對完成只進入等待確認，重建與 alarm 仍保留同一個手動工作', async () => {
    const r = await delivery();
    const first = await r.engine.prepareLine('a', r.call.id, r.input);
    expect(first.job.state).toBe('sending'); expect(first.job.claimedAt).toBeUndefined(); expect(first.job.providerReceipt).toBeUndefined();
    const rebuilt = new MemberEngine(r.f.deps); await rebuilt.alarm();
    expect((await rebuilt.lineTask('a', r.call.id, r.input.jobId)).job.lineAttempt?.id).toBe(r.input.attemptId);
    expect((await rebuilt.lineTask('a', r.call.id, r.input.jobId)).job.state).toBe('sending');
    await expect(rebuilt.prepareLine('a', r.call.id, r.input)).rejects.toMatchObject({ code: 'DELIVERY_ALREADY_ATTEMPTED' });
  });
  it('實際送出證據與聊天室吻合才核銷，重送相同結果不重複處理', async () => {
    const r = await delivery(); await r.engine.prepareLine('a', r.call.id, r.input);
    await expect(r.engine.completeLine('a', r.call.id, { ...r.complete(), chatRef: 'wrong-chat' })).rejects.toMatchObject({ code: 'RECIPIENT_UNVERIFIED' });
    await expect(r.engine.completeLine('a', r.call.id, { ...r.complete(), evidenceSha256: undefined })).rejects.toMatchObject({ code: 'INVALID_DELIVERY_RESULT' });
    const result = await r.engine.completeLine('a', r.call.id, r.complete());
    expect(result.job.state).toBe('succeeded'); expect(result.job.claimedAt).toBe(r.f.now()); expect(result.job.providerReceipt).toBe(r.complete().receipt);
    expect((await r.engine.completeLine('a', r.call.id, r.complete())).job).toEqual(result.job);
    await expect(r.engine.completeLine('a', r.call.id, { ...r.complete(), receipt: 'changed' })).rejects.toMatchObject({ code: 'DELIVERY_ALREADY_ATTEMPTED' });
    await expect(r.engine.prepareLine('a', r.call.id, { ...r.input, attemptId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'DELIVERY_ALREADY_ATTEMPTED' });
  });
  it.each(['rejected', 'unknown'] as const)('%s 保留明確結果、不核銷、不標成功', async outcome => {
    const r = await delivery(); await r.engine.prepareLine('a', r.call.id, r.input);
    const result = await r.engine.completeLine('a', r.call.id, r.complete(outcome));
    expect(result.job.state).toBe(outcome === 'rejected' ? 'failed' : 'unknown');
    expect(result.job.claimedAt).toBeUndefined(); expect(result.job.providerReceipt).toBeUndefined();
    await expect(r.engine.prepareLine('a', r.call.id, r.input)).rejects.toMatchObject({ code: 'DELIVERY_ALREADY_ATTEMPTED' });
  });
  it('等待核對期間內容更新，既有工作標示待確認並拒絕核銷舊成果', async () => {
    const r = await delivery(); await r.engine.prepareLine('a', r.call.id, r.input);
    await r.engine.ingest('a', r.call.id, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'late', transcript: '補充一段資料' });
    expect((await r.f.record(r.call.id))!.deliveries[0]!.state).toBe('unknown');
    await expect(r.engine.completeLine('a', r.call.id, r.complete())).rejects.toMatchObject({ code: 'DOCUMENT_STALE' });
  });
  it('30天到期時原工作、證據與索引一併清除', async () => {
    const r = await delivery(); const index = new LineDeliveryIndex(r.f.store, r.f.now);
    await index.register({ memberId: 'a', recordId: r.call.id, jobId: r.input.jobId, expiresAt: (await r.f.record(r.call.id))!.expiresAt! });
    await r.engine.prepareLine('a', r.call.id, r.input); await r.engine.completeLine('a', r.call.id, r.complete());
    r.f.advance(30 * 86400000); await r.engine.alarm(); await index.prune();
    expect(await r.f.record(r.call.id)).toBeUndefined(); expect(await index.refs()).toEqual([]);
  });
  it('正式 Worker 路由、RPC 與 SQLite 接上索引及核對，會員回應不含內部證據', async () => {
    const runtime = env as unknown as Env; const f = fixture(); const stub = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(await hash('a')));
    const created = await runInDurableObject(stub, async (instance, state) => {
      const store: Store = { get: key => state.storage.get(key), put: (key, value) => state.storage.put(key, value), delete: async key => { await state.storage.delete(key); }, list: prefix => state.storage.list({ prefix }), alarm: at => state.storage.setAlarm(at) };
      const engine = new MemberEngine({ ...f.deps, store }); const r = await prepareRecord(f, engine);
      const created = await engine.requestDelivery('a', r.call.id, { documentId: r.document.id, channel: 'line', recipient: '', operationId: crypto.randomUUID() });
      (instance as unknown as { engine: MemberEngine }).engine = engine;
      return { created, callId: r.call.id, expiresAt: (await engine.get('a', r.call.id)).expiresAt! };
    });
    const key = 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk'; const config = { ...runtime, ECCAL_SERVICE_TOKEN: key, ECCAL: f.eccal };
    const request = (action: string, body: unknown, authorization = `Bearer ${key}`, origin?: string) => worker.fetch(new Request(`https://fixture.invalid/internal/voice-line/${action}`, { method: 'POST', headers: { authorization, 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }), config);
    expect((await request('list', {}, '')).status).toBe(401); expect((await request('list', {}, `Bearer ${key}`, 'https://fixture.invalid')).status).toBe(403);
    const registered = await request('register', { memberId: 'a', recordId: created.callId, jobId: created.created.job.id, expiresAt: created.expiresAt }); expect(registered.status).toBe(200); expect(registered.headers.get('x-voice-line-contract')).toBe('voice-line-v1');
    const input = { jobId: created.created.job.id, claimCode: created.created.claimCode!, observedChatRef: 'fixture-chat', chatRef: 'fixture-chat', attemptId: crypto.randomUUID(), officialAccount: LINE_ACCOUNT, supervised: true };
    expect((await request('prepare', { ...input, chatRef: 'wrong' })).status).toBe(403);
    const prepared = await request('prepare', input); expect(prepared.status).toBe(200); const value = await prepared.json() as { resultUrl: string; claimDigest?: string; attempt: unknown };
    expect(value.resultUrl).toContain(encodeURIComponent(created.callId)); expect(JSON.stringify(value)).not.toContain(created.created.claimCode!); expect(JSON.stringify(value)).not.toContain('claimDigest');
    const completed = await request('complete', { jobId: input.jobId, attemptId: input.attemptId, officialAccount: LINE_ACCOUNT, chatRef: input.chatRef, outcome: 'sent', receipt: 'controlled-ui', evidenceSha256: 'a'.repeat(64) }); expect(completed.status).toBe(200);
    const member = await worker.fetch(new Request(`https://fixture.invalid/api/calls/${created.callId}`, { headers: { cookie: 'fixture=a' } }), config); const body = await member.text(); expect(member.status).toBe(200); expect(body).not.toContain('controlled-ui'); expect(body).not.toContain('lineAttempt'); expect(body).not.toContain('fixture-chat');
    await runInDurableObject(stub, async (_instance, state) => { const stored = await state.storage.get<CallRecord>(`call:${created.callId}`); expect(stored!.deliveries[0]!.state).toBe('succeeded'); });
  });
});
