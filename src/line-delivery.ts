import { AppError, type Store, type DeliveryJob } from './contracts';
import { unbase64url } from './auth-crypto';

export const LINE_ACCOUNT = '@791vlxya';
export const LINE_ACCOUNT_NAME = 'ToldYou 報數據';
export type LineRef = { memberId: string; recordId: string; jobId: string; expiresAt: number };
export type LinePrepare = { jobId: string; claimCode: string; observedChatRef: string; chatRef: string; attemptId: string; officialAccount: string; supervised: true };
export type LineComplete = { jobId: string; attemptId: string; chatRef: string; officialAccount: string; outcome: 'sent' | 'rejected' | 'unknown'; receipt: string; evidenceSha256?: string };

export async function deriveLineClaim(secret: string | undefined, job: Pick<DeliveryJob, 'memberId' | 'recordId' | 'id'>) {
  let bytes: Uint8Array;
  try { bytes = unbase64url(secret ?? ''); if (bytes.length !== 32) throw new Error(); } catch { throw new AppError('LINE_NOT_CONFIGURED'); }
  const key = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('voice-line-claim-v1'), info: new TextEncoder().encode(JSON.stringify([job.memberId, job.recordId, job.id])) }, key, 128);
  return [...new Uint8Array(derived)].map(value => value.toString(16).padStart(2, '0')).join('');
}

const text = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
export function lineInput(action: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_REQUEST', 400);
  const input = value as Record<string, unknown>;
  const fields: Record<string, string[]> = { register: ['memberId', 'recordId', 'jobId', 'expiresAt'], list: [], prepare: ['jobId', 'claimCode', 'observedChatRef', 'chatRef', 'attemptId', 'officialAccount', 'supervised'], complete: ['jobId', 'attemptId', 'chatRef', 'officialAccount', 'outcome', 'receipt', 'evidenceSha256'] };
  const allowed = fields[action];
  if (!allowed || Object.keys(input).some(key => !allowed.includes(key))) throw new AppError('INVALID_REQUEST', 400);
  if (action === 'list') return input;
  if (!text(input.jobId, 100)) throw new AppError('INVALID_REQUEST', 400);
  if (action === 'register') {
    if (!text(input.memberId) || !text(input.recordId, 100) || !Number.isSafeInteger(input.expiresAt) || (input.expiresAt as number) <= Date.now()) throw new AppError('INVALID_REQUEST', 400);
    return input;
  }
  if (!text(input.attemptId, 100) || !/^[A-Za-z0-9_-]{16,100}$/.test(input.attemptId) || !text(input.chatRef, 500) || input.officialAccount !== LINE_ACCOUNT) throw new AppError('RECIPIENT_UNVERIFIED', 403);
  if (action === 'prepare' && input.observedChatRef !== input.chatRef) throw new AppError('RECIPIENT_UNVERIFIED', 403);
  if (action === 'prepare' && (!text(input.claimCode, 100) || !/^[a-f0-9]{32}$/.test(input.claimCode) || input.supervised !== true)) throw new AppError('CLAIM_INVALID', 403);
  if (action === 'complete' && (typeof input.outcome !== 'string' || !['sent', 'rejected', 'unknown'].includes(input.outcome) || !text(input.receipt, 1000) || input.evidenceSha256 !== undefined && (typeof input.evidenceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.evidenceSha256)) || input.outcome === 'sent' && !input.evidenceSha256)) throw new AppError('INVALID_DELIVERY_RESULT', 400);
  return input;
}

export class LineDeliveryIndex {
  constructor(private store: Store, private now: () => number = Date.now) {}
  async initialized() { return await this.store.get('line:index:initialized') === true; }
  async register(ref: LineRef) {
    lineInput('register', ref);
    const key = 'line:task:' + ref.jobId;
    const previous = await this.store.get<LineRef>(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(ref)) throw new AppError('OPERATION_REPLAYED', 409);
    await this.store.put('line:index:initialized', true);
    await this.store.put(key, ref);
    await this.prune();
    return { registered: true as const };
  }
  async refs() { await this.prune(); return [...(await this.store.list<LineRef>('line:task:')).values()]; }
  async ref(jobId: string) {
    const ref = await this.store.get<LineRef>('line:task:' + jobId);
    if (!ref || ref.expiresAt <= this.now()) throw new AppError('DELIVERY_NOT_FOUND', 404);
    return ref;
  }
  async remove(ref: LineRef) {
    const previous = await this.store.get<LineRef>('line:task:' + ref.jobId);
    if (previous && JSON.stringify(previous) === JSON.stringify(ref)) await this.store.delete('line:task:' + ref.jobId);
  }
  async prune() {
    const refs = await this.store.list<LineRef>('line:task:');
    let next = Infinity;
    for (const [key, ref] of refs) {
      if (ref.expiresAt <= this.now()) await this.store.delete(key);
      else next = Math.min(next, ref.expiresAt);
    }
    if (Number.isFinite(next)) await this.store.alarm(next);
  }
}

export async function lineCaller(header: string | null, expected: string | undefined) {
  if (!expected || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(expected)) throw new AppError('LINE_NOT_CONFIGURED');
  const value = /^Bearer ([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/.exec(header ?? '')?.[1];
  if (!value) throw new AppError('UNAUTHORIZED_CALLER', 401);
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([digest(value), digest(expected)]);
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  if (difference) throw new AppError('UNAUTHORIZED_CALLER', 401);
}
