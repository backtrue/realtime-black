import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { HttpEccalQuota } from '../src/eccal-http';
import worker, { type Env } from '../src/worker';

const key = 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'x-voice-contract': 'eccal-voice-v1' } });

describe('ECCAL 語音額度 HTTP 契約', () => {
  it('以專用後端憑證呼叫，會員憑證只放在 authenticate 本文', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ memberId: 'a', eligible: true }));
    const client = new HttpEccalQuota('https://eccal.example.test', key, fetcher);
    expect(await client.authenticate({ cookie: 'auth_token=fixture', authorization: '' })).toEqual({ memberId: 'a', eligible: true });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://eccal.example.test/api/voice/internal/authenticate');
    expect(init?.redirect).toBe('manual'); expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${key}`);
    expect(JSON.parse(String(init?.body))).toEqual({ cookie: 'auth_token=fixture', authorization: '' });
  });
  it('餘額、占用及結算能對回同一會員', async () => {
    const reservation = { id: crypto.randomUUID(), memberId: 'a', seconds: 300, deadline: Date.now() + 300000 };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ memberId: 'a', totalSeconds: 300, billedSeconds: 120, reservedSeconds: 0, remainingSeconds: 180 })).mockResolvedValueOnce(reply(reservation)).mockResolvedValueOnce(reply({ billedSeconds: 90, remainingSeconds: 210 }));
    const client = new HttpEccalQuota('https://eccal.example.test', key, fetcher);
    expect(await client.balance('a')).toBe(180);
    expect(await client.reserve('a', 'fixture-operation-1')).toEqual(reservation);
    expect(await client.settle('a', reservation.id, [])).toEqual({ billedSeconds: 90, remainingSeconds: 210 });
  });
  it.each([
    { memberId: 'b', totalSeconds: 300, billedSeconds: 0, reservedSeconds: 0, remainingSeconds: 300 },
    { memberId: 'a', totalSeconds: 300, billedSeconds: 0, reservedSeconds: 0, remainingSeconds: 301 },
    { memberId: 'a', totalSeconds: 300, billedSeconds: 10, reservedSeconds: 0, remainingSeconds: 300 },
  ])('拒絕錯會員或不一致帳目 $remainingSeconds', async body => {
    const client = new HttpEccalQuota('https://eccal.example.test', key, vi.fn<typeof fetch>().mockResolvedValue(reply(body)));
    await expect(client.balance('a')).rejects.toMatchObject({ code: 'ECCAL_RESPONSE_INVALID' });
  });
  it('服務憑證錯誤不冒充會員失效，未登入回應保留 null', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(null)).mockResolvedValueOnce(reply({ error: 'UNAUTHORIZED_CALLER', detail: 'fixture-private' }, 401));
    const client = new HttpEccalQuota('https://eccal.example.test', key, fetcher);
    expect(await client.authenticate({ cookie: '', authorization: '' })).toBeNull();
    await expect(client.balance('a')).rejects.toMatchObject({ code: 'ECCAL_UNAVAILABLE', status: 503 });
  });
  it('僅傳回已知錯誤，網路例外不帶出服務端內容', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ error: 'RESERVATION_ACTIVE' }, 409)).mockRejectedValueOnce(new Error('fixture-private'));
    const client = new HttpEccalQuota('https://eccal.example.test', key, fetcher);
    await expect(client.reserve('a', 'fixture-operation-1')).rejects.toMatchObject({ code: 'RESERVATION_ACTIVE', status: 409 });
    await expect(client.balance('a')).rejects.toMatchObject({ code: 'ECCAL_UNAVAILABLE', message: 'ECCAL_UNAVAILABLE' });
  });
  it('拒絕轉址、錯版及過大回應', async () => {
    for (const response of [new Response(null, { status: 302, headers: { location: 'https://other.example.test' } }), Response.json(null), reply({ text: 'x'.repeat(9000) })]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(new HttpEccalQuota('https://eccal.example.test', key, fetcher).balance('a')).rejects.toMatchObject({ code: 'ECCAL_RESPONSE_INVALID' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  const credentialedOrigin = new URL('https://eccal.example.test');
  credentialedOrigin.username = 'fixture-user'; credentialedOrigin.password = 'fixture-password';
  it.each(['http://public.example.test', 'https://eccal.example.test/', credentialedOrigin.href.slice(0, -1), 'https://eccal.example.test/path'])('拒絕不合格來源 %s', origin => {
    expect(() => new HttpEccalQuota(origin, key)).toThrow('ECCAL_CONFIGURATION_INVALID');
  });
  it('實際 Worker /api/me 可使用 HTTP 額度來源且不回傳會員或服務權杖', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply({ memberId: 'a', eligible: true })).mockResolvedValueOnce(reply({ memberId: 'a', totalSeconds: 300, billedSeconds: 90, reservedSeconds: 0, remainingSeconds: 210 }));
    try {
      const response = await worker.fetch(new Request('https://fixture.invalid/api/me', { headers: { cookie: 'auth_token=fixture' } }), { ...env as unknown as Env, ECCAL_ORIGIN: 'https://eccal.example.test', ECCAL_SERVICE_TOKEN: key });
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ eligible: true, remainingSeconds: 210 });
      expect(response.headers.get('cache-control')).toBe('no-store');
    } finally { fetcher.mockRestore(); }
  });
});
