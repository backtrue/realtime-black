import { AppError, type EccalPort, type Credentials, type Identity, type MeterEvent, type Reservation, type Settlement } from './contracts';

const VERSION = 'eccal-voice-v1';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const seconds = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 300;

export class HttpEccalQuota implements Omit<EccalPort, 'mcpGrant'> {
  private origin: string;
  constructor(origin: string, private serviceToken: string, private fetcher: typeof fetch = fetch) {
    try {
      const url = new URL(origin);
      if (url.origin !== origin || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error();
      if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(serviceToken)) throw new Error();
      this.origin = url.origin;
    } catch { throw new AppError('ECCAL_CONFIGURATION_INVALID'); }
  }
  private async request(action: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.origin}/api/voice/internal/${action}`, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
        headers: { authorization: `Bearer ${this.serviceToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
    } catch { throw new AppError('ECCAL_UNAVAILABLE'); }
    if (response.headers.get('x-voice-contract') !== VERSION || !response.headers.get('content-type')?.startsWith('application/json')) throw new AppError('ECCAL_RESPONSE_INVALID');
    const reader = response.body?.getReader();
    if (!reader) throw new AppError('ECCAL_RESPONSE_INVALID');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 8192) { await reader.cancel(); throw new AppError('ECCAL_RESPONSE_INVALID'); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); } catch { throw new AppError('ECCAL_RESPONSE_INVALID'); }
    if (!response.ok) {
      const allowed: Record<string, number> = { QUOTA_EXHAUSTED: 403, RESERVATION_ACTIVE: 409, RESERVATION_NOT_FOUND: 404, SETTLEMENT_CONFLICT: 409, INVALID_REQUEST: 400, INVALID_METER_EVENTS: 400, MEMBER_NOT_FOUND: 404 };
      const code = object(value) && typeof value.error === 'string' ? value.error : '';
      if (Object.hasOwn(allowed, code) && response.status === allowed[code]) throw new AppError(code, response.status);
      throw new AppError('ECCAL_UNAVAILABLE');
    }
    return value;
  }
  async exchangeLogin(code: string, state: string): Promise<{ memberId: string; sessionToken: string; expiresAt: number }> {
    const value = await this.request('login/exchange', { code, state });
    if (!object(value) || typeof value.memberId !== 'string' || !value.memberId || typeof value.sessionToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.sessionToken) || !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= Date.now()) throw new AppError('ECCAL_RESPONSE_INVALID');
    return { memberId: value.memberId, sessionToken: value.sessionToken, expiresAt: value.expiresAt as number };
  }
  async revokeSession(sessionToken: string) {
    const value = await this.request('login/revoke', { sessionToken });
    if (!object(value) || value.revoked !== true) throw new AppError('ECCAL_RESPONSE_INVALID');
  }
  async verifyMcpAccount(memberId: string, accountEmail: string) {
    const value = await this.request('login/mcp-identity', { memberId, accountEmail });
    if (!object(value) || value.memberId !== memberId || typeof value.matches !== 'boolean') throw new AppError('ECCAL_RESPONSE_INVALID');
    if (!value.matches) throw new AppError('MCP_MEMBER_MISMATCH', 403);
  }
  async authenticate(credentials: Credentials): Promise<Identity | null> {
    const value = await this.request('authenticate', credentials);
    if (value === null) return null;
    if (!object(value) || typeof value.memberId !== 'string' || !value.memberId || value.memberId.length > 256 || typeof value.eligible !== 'boolean') throw new AppError('ECCAL_RESPONSE_INVALID');
    return { memberId: value.memberId, eligible: value.eligible };
  }
  async balance(memberId: string): Promise<number> {
    const value = await this.request('balance', { memberId });
    if (!object(value) || value.memberId !== memberId || value.totalSeconds !== 300 || !seconds(value.billedSeconds) || !seconds(value.reservedSeconds) || !seconds(value.remainingSeconds) || value.billedSeconds + value.reservedSeconds + value.remainingSeconds !== 300) throw new AppError('ECCAL_RESPONSE_INVALID');
    return value.remainingSeconds;
  }
  async reserve(memberId: string, operationId: string): Promise<Reservation> {
    const value = await this.request('reserve', { memberId, operationId });
    if (!object(value) || value.memberId !== memberId || typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id) || !seconds(value.seconds) || value.seconds === 0 || !Number.isSafeInteger(value.deadline)) throw new AppError('ECCAL_RESPONSE_INVALID');
    return { id: value.id, memberId, seconds: value.seconds, deadline: value.deadline as number };
  }
  async settle(memberId: string, reservationId: string, events: MeterEvent[]): Promise<Settlement> {
    const value = await this.request('settle', { memberId, reservationId, events });
    if (!object(value) || !seconds(value.billedSeconds) || !seconds(value.remainingSeconds)) throw new AppError('ECCAL_RESPONSE_INVALID');
    return { billedSeconds: value.billedSeconds, remainingSeconds: value.remainingSeconds };
  }
}
