import { AppError, type Identity, type McpGrant } from './contracts';
import { appOrigin, checkLoginState, cookieHeader, cookieName, hash, loginState, randomSecret, readCookie } from './auth-crypto';
import { HttpEccalQuota } from './eccal-http';

export type AuthorizationPort = {
  begin(memberId: string, session: string, browser: string): Promise<{ url: string }>;
  complete(memberId: string, session: string, browser: string, input: { state: string; code?: string; error?: string; issuer?: string }): Promise<void>;
  grant(memberId: string): Promise<McpGrant>;
  revoke(memberId: string): Promise<{ pending: boolean }>;
};
export type AuthSettings = { APP_ORIGIN?: string; ECCAL_ORIGIN?: string; ECCAL_SERVICE_TOKEN?: string; MCP_CLIENT_ID?: string };
export async function authRoutes(request: Request, settings: AuthSettings, vault: (memberId: string) => AuthorizationPort): Promise<Response> {
  const origin = appOrigin(settings.APP_ORIGIN), url = new URL(request.url), path = url.pathname;
  if (url.origin !== origin) throw new AppError('ORIGIN_FORBIDDEN', 403);
  const quota = new HttpEccalQuota(settings.ECCAL_ORIGIN ?? '', settings.ECCAL_SERVICE_TOKEN ?? '');
  const redirect = (target: string, cookies: string[] = []) => { const headers = new Headers({ location: target }); for (const cookie of cookies) headers.append('set-cookie', cookie); return new Response(null, { status: 303, headers }); };
  const sessionToken = readCookie(request, cookieName(origin, 'session'));
  const identity = async (): Promise<Identity> => {
    const value = await quota.authenticate({ cookie: request.headers.get('cookie') ?? '', authorization: request.headers.get('authorization') ?? '' });
    if (!value) throw new AppError('LOGIN_REQUIRED', 401);
    return value;
  };
  if (path === '/oauth/client-metadata.json' && request.method === 'GET') return Response.json({ client_id: `${origin}/oauth/client-metadata.json`, client_name: '打電話給小黑', redirect_uris: [`${origin}/auth/mcp/callback`], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'thinkwithblack.use thinkwithblack.methods.read' });
  if (path === '/auth/login' && request.method === 'GET') {
    const browser = randomSecret(), state = await loginState(settings.ECCAL_SERVICE_TOKEN, origin, browser);
    const login = new URL('/api/voice/login', settings.ECCAL_ORIGIN); login.searchParams.set('state', state);
    return redirect(login.href, [cookieHeader(origin, 'login', browser, 600)]);
  }
  if (path === '/auth/callback' && request.method === 'GET') {
    const clear = cookieHeader(origin, 'login', '', 0);
    try {
      const state = url.searchParams.get('state'), code = url.searchParams.get('code'), browser = readCookie(request, cookieName(origin, 'login'));
      if (Array.from(url.searchParams.keys()).some(key => !['code', 'state'].includes(key)) || !state || !code || !/^[A-Za-z0-9_-]{43}$/.test(code) || !browser || !await checkLoginState(state, settings.ECCAL_SERVICE_TOKEN, origin, browser)) throw new AppError('LOGIN_STATE_INVALID', 400);
      const session = await quota.exchangeLogin(code, state);
      return redirect(`${origin}/`, [cookieHeader(origin, 'session', session.sessionToken, (session.expiresAt - Date.now()) / 1000), clear]);
    } catch { return redirect(`${origin}/?auth=login-failed`, [clear]); }
  }
  if (request.method === 'POST' && request.headers.get('origin') !== origin) throw new AppError('ORIGIN_FORBIDDEN', 403);
  if (path === '/auth/logout' && request.method === 'POST') {
    if (sessionToken) await quota.revokeSession(sessionToken);
    return Response.json({ loggedOut: true }, { headers: { 'set-cookie': cookieHeader(origin, 'session', '', 0) } });
  }
  if (path === '/auth/status' && request.method === 'GET') {
    const member = await quota.authenticate({ cookie: request.headers.get('cookie') ?? '', authorization: request.headers.get('authorization') ?? '' });
    return Response.json({ authenticated: member !== null });
  }
  if (path === '/auth/mcp/connect' && request.method === 'GET') {
    const member = await identity();
    if (!sessionToken) throw new AppError('LOGIN_REQUIRED', 401);
    const browser = randomSecret(), created = await vault(member.memberId).begin(member.memberId, await hash(sessionToken), browser);
    return redirect(created.url, [cookieHeader(origin, 'oauth', browser, 600)]);
  }
  if (path === '/auth/mcp/callback' && request.method === 'GET') {
    const clear = cookieHeader(origin, 'oauth', '', 0);
    try {
      const member = await identity(), browser = readCookie(request, cookieName(origin, 'oauth')), state = url.searchParams.get('state');
      if (!sessionToken || !browser || !state || !/^[A-Za-z0-9_-]{43}$/.test(state) || Array.from(url.searchParams.keys()).some(key => !['state', 'code', 'iss', 'error', 'error_description'].includes(key))) throw new AppError('MCP_STATE_INVALID', 400);
      const code = url.searchParams.get('code') ?? undefined, error = url.searchParams.get('error') ?? undefined;
      if (code && code.length > 8192 || error && error.length > 100) throw new AppError('MCP_STATE_INVALID', 400);
      await vault(member.memberId).complete(member.memberId, await hash(sessionToken), browser, { state, code, error, issuer: url.searchParams.get('iss') ?? undefined });
      return redirect(`${origin}/?auth=mcp-connected`, [clear]);
    } catch { return redirect(`${origin}/?auth=mcp-failed`, [clear]); }
  }
  if (path === '/auth/mcp/revoke' && request.method === 'POST') {
    const member = await identity();
    const result = await vault(member.memberId).revoke(member.memberId);
    return Response.json({ authorized: false, revocationPending: result.pending }, { status: result.pending ? 202 : 200 });
  }
  throw new AppError('NOT_FOUND', 404);
}
