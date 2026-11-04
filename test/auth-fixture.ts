import { vi } from 'vitest';
import { AppError, type Store } from '../src/contracts';
import { MemberAuthorization } from '../src/member-authorization';
import { McpOAuth, MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE, READ_ONLY_TOOLS } from '../src/mcp-oauth';
import { ThinkWithBlackMcp } from '../src/mcp';
import { base64url } from '../src/auth-crypto';

export const authKey = 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk';
export function oauthFixture() {
  const codes = new Map<string, { challenge: string; member: string }>();
  const tokens = new Map<string, { member: string; active: boolean; grant: string }>();
  const state = { failRevoke: false, refreshes: 0, exchanges: 0, revokes: 0 };
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/.well-known/oauth-protected-resource/mcp')) return Response.json({ resource: MCP_RESOURCE, authorization_servers: [MCP_ISSUER] });
    if (url.endsWith('/.well-known/oauth-authorization-server')) return Response.json({ issuer: MCP_ISSUER, authorization_endpoint: `${MCP_ISSUER}/authorize`, token_endpoint: `${MCP_ISSUER}/oauth/token`, revocation_endpoint: `${MCP_ISSUER}/oauth/token`, scopes_supported: MCP_SCOPE.split(' '), code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], client_id_metadata_document_supported: true });
    if (url.endsWith('/oauth/token')) {
      const params = new URLSearchParams(String(init?.body));
      if (params.has('token')) {
        state.revokes += 1;
        if (state.failRevoke) return Response.json({ error: 'temporarily_unavailable' }, { status: 503 });
        const token = tokens.get(params.get('token')!);
        if (token) for (const value of tokens.values()) if (value.grant === token.grant) value.active = false;
        return new Response(null, { status: 200 });
      }
      let member: string, grant: string;
      if (params.get('grant_type') === 'authorization_code') {
        const code = codes.get(params.get('code') ?? '');
        state.exchanges += 1;
        const verifier = params.get('code_verifier') ?? '';
        const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
        if (!code || code.challenge !== challenge || params.get('resource') !== MCP_RESOURCE) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        codes.delete(params.get('code')!); member = code.member; grant = crypto.randomUUID();
      } else {
        const token = tokens.get(params.get('refresh_token') ?? ''); state.refreshes += 1;
        if (!token?.active) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        token.active = false; member = token.member; grant = token.grant;
      }
      const access = `fixture-access-${crypto.randomUUID()}`, refresh = `fixture-refresh-${crypto.randomUUID()}`;
      tokens.set(access, { member, active: true, grant }); tokens.set(refresh, { member, active: true, grant });
      return Response.json({ access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'Bearer', scope: MCP_SCOPE.split(' ').reverse().join(' ') });
    }
    if (url === MCP_RESOURCE) {
      const token = tokens.get(new Headers(init?.headers).get('authorization')?.slice(7) ?? '');
      if (!token?.active) return new Response(null, { status: 401 });
      const body = JSON.parse(String(init?.body)); let result: unknown;
      if (body.method === 'server/discover') result = { protocolVersions: ['2026-07-28'], capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
      else if (body.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
      else if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      else if (body.method === 'tools/list') result = { tools: [...READ_ONLY_TOOLS, 'pause_ad', 'gsc_query'].map(name => ({ name, inputSchema: { type: 'object', properties: {} } })) };
      else result = body.params.name === 'thinkwithblack_get_account_status' ? { content: [], structuredContent: { account_email: `${token.member}@example.test`, membership: 'pro', credits: 7, available_modules: [] } } : { content: [{ type: 'text', text: `fixture-method-for-${token.member}` }] };
      return Response.json({ jsonrpc: '2.0', id: body.id, result });
    }
    throw new Error('unexpected fixture URL');
  });
  const authorize = (memberId: string, store?: Store) => {
    const data = new Map<string, unknown>();
    const actual: Store = store ?? { get: async key => structuredClone(data.get(key)) as any, put: async (key, value) => { data.set(key, structuredClone(value)); }, delete: async key => { data.delete(key); }, list: async prefix => new Map(Array.from(data).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value) as any])), alarm: vi.fn(async () => {}) };
    const mcp = new ThinkWithBlackMcp(fetcher);
    const auth = new MemberAuthorization({ store: actual, secret: authKey, oauth: new McpOAuth('https://voice.example.test', undefined, fetcher), mcp, account: grant => mcp.account(grant), verifyAccount: async (id, email) => { if (email !== `${id}@example.test`) throw new AppError('MCP_MEMBER_MISMATCH', 403); } });
    const begin = async (providerMember = memberId) => {
      const result = await auth.begin(memberId, 'fixture-session', 'fixture-browser'); const url = new URL(result.url); const code = crypto.randomUUID();
      codes.set(code, { challenge: url.searchParams.get('code_challenge')!, member: providerMember });
      return { url, input: { state: url.searchParams.get('state')!, code, issuer: MCP_ISSUER } };
    };
    const connect = async () => { const flow = await begin(); await auth.complete(memberId, 'fixture-session', 'fixture-browser', flow.input); return flow; };
    return { auth, data, store: actual, begin, connect, mcp };
  };
  return { fetcher, tokens, codes, state, authorize };
}
