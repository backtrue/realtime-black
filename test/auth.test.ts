import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import type { Store } from '../src/contracts';
import type { Env } from '../src/worker';
import { decrypt, encrypt, loginState, checkLoginState, readCookie } from '../src/auth-crypto';
import { McpOAuth, MCP_SCOPE, READ_ONLY_TOOLS, type OAuthCredential } from '../src/mcp-oauth';
import { oauthFixture, authKey } from './auth-fixture';

afterEach(() => vi.restoreAllMocks());
describe('跨站登入與個人 MCP 授權', () => {
  it('登入state核對簽章、瀏覽器、origin，重複cookie不採用', async () => {
    const state = await loginState(authKey, 'https://voice.example.test', 'fixture-browser');
    expect(await checkLoginState(state, authKey, 'https://voice.example.test', 'fixture-browser')).toBe(true);
    expect(await checkLoginState(state, authKey, 'https://voice.example.test', 'other-browser')).toBe(false);
    expect(await checkLoginState(state, authKey, 'https://other.example.test', 'fixture-browser')).toBe(false);
    expect(await checkLoginState(state + 'x', authKey, 'https://voice.example.test', 'fixture-browser')).toBe(false);
    expect(readCookie(new Request('https://fixture.test', { headers: { cookie: 'a=first; a=second' } }), 'a')).toBeUndefined();
  });
  it('加密資料綁會員與用途，錯會員無法解密', async () => {
    const ciphertext = await encrypt({ token: 'fixture-private' }, authKey, 'a:grant');
    expect(ciphertext).not.toContain('fixture-private');
    expect(await decrypt(ciphertext, authKey, 'a:grant')).toEqual({ token: 'fixture-private' });
    await expect(decrypt(ciphertext, authKey, 'b:grant')).rejects.toMatchObject({ code: 'AUTH_DATA_INVALID' });
  });
  it('PKCE S256只要求方法庫scope，兩位會員分別取得自己的工具結果', async () => {
    const f = oauthFixture(); const a = f.authorize('a'), b = f.authorize('b');
    const blankClient = new URL(await new McpOAuth('https://voice.example.test', '', f.fetcher).authorize('fixture-state', 'fixture-challenge'));
    expect(blankClient.searchParams.get('client_id')).toBe('https://voice.example.test/oauth/client-metadata.json');
    expect(() => new McpOAuth('http://127.0.0.1:8787', '').clientId).toThrowError('MCP_CLIENT_NOT_CONFIGURED');
    const flow = await a.connect(); await b.connect();
    expect(flow.url.searchParams.get('scope')).toBe(MCP_SCOPE); expect(flow.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(flow.url.searchParams.get('client_id')).toBe('https://voice.example.test/oauth/client-metadata.json');
    const ga = await a.auth.grant('a'), gb = await b.auth.grant('b'); expect(ga.authorizationId).not.toBe(gb.authorizationId); expect(ga.accessToken).toBeUndefined();
    expect((await a.auth.list('a', ga.authorizationId!)).map(tool => tool.name)).toEqual(READ_ONLY_TOOLS);
    expect(JSON.stringify(await a.auth.call('a', ga.authorizationId!, READ_ONLY_TOOLS[0]!, {}))).toContain('fixture-method-for-a');
    expect(JSON.stringify(await b.auth.call('b', gb.authorizationId!, READ_ONLY_TOOLS[0]!, {}))).toContain('fixture-method-for-b');
    await expect(a.auth.call('a', ga.authorizationId!, 'gsc_query', {})).rejects.toMatchObject({ code: 'TOOL_FORBIDDEN' });
    await expect(a.mcp.call(ga, READ_ONLY_TOOLS[0]!, {})).rejects.toMatchObject({ code: 'MCP_AUTH_EXPIRED' });
    await expect(a.auth.grant('b')).rejects.toMatchObject({ code: 'MCP_MEMBER_MISMATCH' });
    const persisted = JSON.stringify(Array.from(a.data.values())); expect(persisted).not.toContain('fixture-access-'); expect(persisted).not.toContain('fixture-refresh-');
  });
  it('錯瀏覽器或換過登入會話的callback不交換code，正常callback只接受一次', async () => {
    const f = oauthFixture(), a = f.authorize('a'); const flow = await a.begin();
    await expect(a.auth.complete('a', 'other-session', 'fixture-browser', flow.input)).rejects.toMatchObject({ code: 'MCP_STATE_INVALID' });
    await expect(a.auth.complete('a', 'fixture-session', 'other-browser', flow.input)).rejects.toMatchObject({ code: 'MCP_STATE_INVALID' });
    expect(f.state.exchanges).toBe(0);
    await a.auth.complete('a', 'fixture-session', 'fixture-browser', flow.input);
    await expect(a.auth.complete('a', 'fixture-session', 'fixture-browser', flow.input)).rejects.toMatchObject({ code: 'MCP_STATE_INVALID' }); expect(f.state.exchanges).toBe(1);
  });
  it('錯issuer及拒絕授權不取得憑證', async () => {
    const f = oauthFixture(), a = f.authorize('a'); const first = await a.begin();
    await expect(a.auth.complete('a', 'fixture-session', 'fixture-browser', { ...first.input, issuer: 'https://evil.example.test' })).rejects.toMatchObject({ code: 'MCP_ISSUER_INVALID' });
    const second = await a.begin(); await expect(a.auth.complete('a', 'fixture-session', 'fixture-browser', { state: second.input.state, error: 'access_denied' })).rejects.toMatchObject({ code: 'MCP_AUTH_DENIED' });
    expect(f.state.exchanges).toBe(0); await expect(a.auth.grant('a')).rejects.toMatchObject({ code: 'MCP_AUTH_REQUIRED' });
  });
  it('登入A卻授權B時拒絕保存，撤銷這筆錯帳號grant', async () => {
    const f = oauthFixture(), a = f.authorize('a'); const flow = await a.begin('b');
    await expect(a.auth.complete('a', 'fixture-session', 'fixture-browser', flow.input)).rejects.toMatchObject({ code: 'MCP_MEMBER_MISMATCH' });
    expect(a.data.has('grant')).toBe(false); await a.auth.alarm();
    expect(Array.from(f.tokens.values()).every(token => !token.active)).toBe(true);
  });
  it('access token即將到期時換發，使用同一會員的新token重新核對', async () => {
    const f = oauthFixture(), a = f.authorize('a'); await a.connect();
    const stored = a.data.get('grant') as { ciphertext: string; expiresAt: number };
    const credential = await decrypt<OAuthCredential>(stored.ciphertext, authKey, 'a:grant'); credential.expiresAt = 1;
    a.data.set('grant', { ...stored, ciphertext: await encrypt(credential, authKey, 'a:grant') });
    const refreshed = await a.auth.grant('a'); expect(refreshed.accessToken).toBeUndefined(); expect(f.state.refreshes).toBe(1);
  });
  it('提供者撤銷後下一次工具取得授權即拒絕', async () => {
    const f = oauthFixture(), a = f.authorize('a'); await a.connect();
    for (const token of f.tokens.values()) token.active = false;
    await expect(a.auth.grant('a')).rejects.toMatchObject({ code: 'MCP_AUTH_REVOKED' }); expect(a.data.has('grant')).toBe(false);
  });
  it('本機先停用，提供者撤銷不明保留加密工作，alarm重試確認後清除', async () => {
    const f = oauthFixture(), a = f.authorize('a'); await a.connect(); f.state.failRevoke = true;
    expect(await a.auth.revoke('a')).toEqual({ pending: true });
    await expect(a.auth.grant('a')).rejects.toMatchObject({ code: 'MCP_AUTH_REQUIRED' });
    expect(Array.from(a.data.keys()).some(key => key.startsWith('revoke:'))).toBe(true);
    f.state.failRevoke = false; await a.auth.alarm();
    expect(Array.from(a.data.keys()).some(key => key.startsWith('revoke:'))).toBe(false);
    expect(Array.from(f.tokens.values()).every(token => !token.active)).toBe(true);
  });
  it('grant後撤銷再延遲呼叫，即使提供者尚未撤銷也不能用舊handle查詢', async () => {
    const f = oauthFixture(), a = f.authorize('a'); await a.connect(); const grant = await a.auth.grant('a');
    f.state.failRevoke = true; expect(await a.auth.revoke('a')).toEqual({ pending: true });
    expect(Array.from(f.tokens.values()).some(token => token.active)).toBe(true);
    await expect(a.auth.call('a', grant.authorizationId!, READ_ONLY_TOOLS[0]!, {})).rejects.toMatchObject({ code: 'MCP_AUTH_REQUIRED' });
    await a.connect(); await expect(a.auth.call('a', grant.authorizationId!, READ_ONLY_TOOLS[0]!, {})).rejects.toMatchObject({ code: 'MCP_AUTH_REVOKED' });
  });
  it('到期清除pending與grant，已過期refresh不再使用', async () => {
    const f = oauthFixture(), a = f.authorize('a'); await a.connect();
    const stored = a.data.get('grant') as object; a.data.set('grant', { ...stored, expiresAt: Date.now() - 1 });
    await a.auth.alarm(); expect(a.data.has('grant')).toBe(false); await expect(a.auth.grant('a')).rejects.toMatchObject({ code: 'MCP_AUTH_REQUIRED' });
  });
  it('AuthVault實際RPC並行callback只有一筆交換，SQLite只保存密文', async () => {
    const runtime = env as unknown as Env, f = oauthFixture();
    const stub = runtime.AUTH.get(runtime.AUTH.idFromName(crypto.randomUUID()));
    let flow!: { input: { state: string; code: string; issuer: string } };
    await runInDurableObject(stub, async (instance, state) => {
      const store: Store = { get: key => state.storage.get(key), put: (key, value) => state.storage.put(key, value), delete: async key => { await state.storage.delete(key); }, list: prefix => state.storage.list({ prefix }), alarm: at => state.storage.setAlarm(at) };
      const fixture = f.authorize('a', store); flow = await fixture.begin();
      (instance as unknown as { authorization: typeof fixture.auth }).authorization = fixture.auth;
    });
    const results = await Promise.all([stub.complete('a', 'fixture-session', 'fixture-browser', flow.input), stub.complete('a', 'fixture-session', 'fixture-browser', flow.input)]);
    expect(results.filter(result => result.ok)).toHaveLength(1); expect(f.state.exchanges).toBe(1);
    await runInDurableObject(stub, async (_instance, state) => { const stored = JSON.stringify(Array.from(await state.storage.list())); expect(stored).not.toContain('fixture-access-'); expect(stored).not.toContain('fixture-refresh-'); await state.storage.deleteAll(); await state.storage.deleteAlarm(); });
  });
  it('AuthVault的工具呼叫與撤銷序列化，撤銷回覆後舊handle不能重用', async () => {
    const runtime = env as unknown as Env, f = oauthFixture(); const stub = runtime.AUTH.get(runtime.AUTH.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, async (instance, state) => {
      const store: Store = { get: key => state.storage.get(key), put: (key, value) => state.storage.put(key, value), delete: async key => { await state.storage.delete(key); }, list: prefix => state.storage.list({ prefix }), alarm: at => state.storage.setAlarm(at) };
      const fixture = f.authorize('a', store); await fixture.connect(); (instance as unknown as { authorization: typeof fixture.auth }).authorization = fixture.auth;
    });
    const result = await stub.grant('a'); expect(result.ok).toBe(true); if (!result.ok) return;
    const handle = result.value.authorizationId!;
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let started = false;
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (input, init) => { const body = String(input).endsWith('/mcp') && init?.body ? JSON.parse(String(init.body)) : null; if (body?.method === 'tools/call' && body.params.name === READ_ONLY_TOOLS[0]) { started = true; await held; } return original(input, init); });
    const calling = stub.call('a', handle, READ_ONLY_TOOLS[0]!, {});
    await vi.waitFor(() => expect(started).toBe(true));
    f.state.failRevoke = true;
    let revoked = false; const revoking = stub.revoke('a').then(result => { revoked = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 10)); expect(revoked).toBe(false);
    release(); expect((await calling).ok).toBe(true); expect(await revoking).toMatchObject({ ok: true, value: { pending: true } });
    expect(await stub.call('a', handle, READ_ONLY_TOOLS[0]!, {})).toMatchObject({ ok: false, error: 'MCP_AUTH_REQUIRED' });
    await runInDurableObject(stub, async (_instance, state) => { await state.storage.deleteAll(); await state.storage.deleteAlarm(); });
  });
});
