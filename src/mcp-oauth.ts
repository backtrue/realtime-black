import { AppError } from './contracts';
import { appOrigin } from './auth-crypto';

export const MCP_ISSUER = 'https://mcp.thinkwithblack.com';
export const MCP_RESOURCE = `${MCP_ISSUER}/mcp`;
export const MCP_SCOPES = ['thinkwithblack.use', 'thinkwithblack.methods.read'] as const;
export const MCP_SCOPE = MCP_SCOPES.join(' ');
const sameScopes = (value: unknown) => typeof value === 'string' && value.trim().split(/\s+/).length === MCP_SCOPES.length && new Set(value.trim().split(/\s+/)).size === MCP_SCOPES.length && value.trim().split(/\s+/).every(scope => MCP_SCOPES.some(expected => expected === scope));
export const READ_ONLY_TOOLS = ['thinkwithblack_entry_catalog', 'thinkwithblack_entry_read', 'thinkwithblack_marketing_skill_search', 'thinkwithblack_marketing_skill_read', 'thinkwithblack_list_modules'];
export type OAuthCredential = { accessToken: string; refreshToken?: string; expiresAt: number; refreshExpiresAt: number; clientId: string };
export class McpOAuth {
  constructor(private origin: string, private configuredClientId?: string, private fetcher: typeof fetch = fetch) {}
  get clientId() {
    appOrigin(this.origin);
    const value = this.configuredClientId || (this.origin.startsWith('https:') ? `${this.origin}/oauth/client-metadata.json` : '');
    if (!value || value.length > 2048 || /[\s\x00-\x1f]/.test(value)) throw new AppError('MCP_CLIENT_NOT_CONFIGURED');
    return value;
  }
  private async request(url: string, init?: RequestInit) {
    let response: Response;
    try { response = await this.fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(10000) }); }
    catch { throw new AppError('MCP_OAUTH_UNAVAILABLE', 502); }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) {
      try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 32768) { await reader.cancel(); throw new AppError('MCP_OAUTH_INVALID', 502); } chunks.push(item.value); } }
      finally { reader.releaseLock(); }
    }
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return { response, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes) };
  }
  async metadata() {
    const resource = await this.request(`${MCP_ISSUER}/.well-known/oauth-protected-resource/mcp`);
    const auth = await this.request(`${MCP_ISSUER}/.well-known/oauth-authorization-server`);
    try {
      const r = JSON.parse(resource.text), a = JSON.parse(auth.text);
      if (!resource.response.ok || !auth.response.ok || r.resource !== MCP_RESOURCE || !Array.isArray(r.authorization_servers) || !r.authorization_servers.includes(MCP_ISSUER) || a.issuer !== MCP_ISSUER || a.authorization_endpoint !== `${MCP_ISSUER}/authorize` || a.token_endpoint !== `${MCP_ISSUER}/oauth/token` || a.revocation_endpoint !== a.token_endpoint || !a.code_challenge_methods_supported?.includes('S256') || !Array.isArray(a.scopes_supported) || !MCP_SCOPES.every(scope => a.scopes_supported.includes(scope)) || !a.token_endpoint_auth_methods_supported?.includes('none')) throw new Error();
      if (!this.configuredClientId && a.client_id_metadata_document_supported !== true) throw new Error();
      return a as { issuer: string; authorization_endpoint: string; token_endpoint: string; revocation_endpoint: string };
    } catch { throw new AppError('MCP_METADATA_INVALID', 502); }
  }
  async authorize(state: string, challenge: string) {
    const metadata = await this.metadata();
    const url = new URL(metadata.authorization_endpoint);
    url.search = new URLSearchParams({ response_type: 'code', client_id: this.clientId, redirect_uri: `${this.origin}/auth/mcp/callback`, resource: MCP_RESOURCE, scope: MCP_SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state }).toString();
    return url.href;
  }
  private async token(params: URLSearchParams, clientId: string, refreshExpiresAt?: number): Promise<OAuthCredential> {
    const result = await this.request(`${MCP_ISSUER}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    if (result.response.status === 400 || result.response.status === 401) throw new AppError('MCP_AUTH_REVOKED', 403);
    try {
      const value = JSON.parse(result.text);
      if (!result.response.ok || typeof value.access_token !== 'string' || !value.access_token || value.access_token.length > 8192 || String(value.token_type).toLowerCase() !== 'bearer' || !Number.isSafeInteger(value.expires_in) || value.expires_in <= 0 || value.expires_in > 3600 || !sameScopes(value.scope ?? MCP_SCOPE) || value.refresh_token !== undefined && (typeof value.refresh_token !== 'string' || !value.refresh_token || value.refresh_token.length > 8192)) throw new Error();
      const expiresAt = Date.now() + value.expires_in * 1000;
      return { clientId, accessToken: value.access_token, refreshToken: value.refresh_token, expiresAt, refreshExpiresAt: refreshExpiresAt ?? (value.refresh_token ? Date.now() + 2592000000 : expiresAt) };
    } catch { throw new AppError('MCP_OAUTH_INVALID', 502); }
  }
  exchange(code: string, verifier: string) {
    return this.token(new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: this.clientId, redirect_uri: `${this.origin}/auth/mcp/callback`, resource: MCP_RESOURCE }), this.clientId);
  }
  async refresh(credential: OAuthCredential) {
    if (!credential.refreshToken || credential.refreshExpiresAt <= Date.now()) throw new AppError('MCP_AUTH_EXPIRED', 403);
    const refreshed = await this.token(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credential.refreshToken, client_id: credential.clientId, resource: MCP_RESOURCE, scope: MCP_SCOPE }), credential.clientId, credential.refreshExpiresAt);
    return { ...refreshed, refreshToken: refreshed.refreshToken ?? credential.refreshToken };
  }
  async revoke(credential: OAuthCredential) {
    const result = await this.request(`${MCP_ISSUER}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: credential.refreshToken ?? credential.accessToken, token_type_hint: credential.refreshToken ? 'refresh_token' : 'access_token', client_id: credential.clientId }).toString() });
    if (result.response.status !== 200 || result.text.trim() !== '') throw new AppError('MCP_REVOKE_UNCONFIRMED', 502);
  }
}
