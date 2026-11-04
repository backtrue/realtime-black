import { AppError, type Store, type McpGrant, type McpPort } from './contracts';
import { base64url, decrypt, encrypt, hash, randomSecret } from './auth-crypto';
import { MCP_ISSUER, McpOAuth, READ_ONLY_TOOLS, type OAuthCredential } from './mcp-oauth';

type Pending = { verifier: string; session: string; browser: string };
type Stored = { ciphertext: string; expiresAt: number };
type Credential = OAuthCredential & { authorizationId: string };
export class MemberAuthorization {
  constructor(private deps: { store: Store; secret?: string; oauth: McpOAuth; mcp: McpPort; account: (grant: McpGrant) => Promise<string>; verifyAccount: (memberId: string, email: string) => Promise<void> }) {}
  private async owner(memberId: string) {
    const owner = await this.deps.store.get<string>('owner');
    if (owner && owner !== memberId) throw new AppError('MCP_MEMBER_MISMATCH', 403);
    if (!owner) await this.deps.store.put('owner', memberId);
  }
  private async put(memberId: string, key: string, value: unknown, expiresAt: number) {
    await this.deps.store.put(key, { ciphertext: await encrypt(value, this.deps.secret, `${memberId}:${key}`), expiresAt });
    await this.schedule();
  }
  private async get<T>(memberId: string, key: string): Promise<T | undefined> {
    const stored = await this.deps.store.get<Stored>(key);
    if (!stored) return;
    if (stored.expiresAt <= Date.now()) { await this.deps.store.delete(key); return; }
    return decrypt<T>(stored.ciphertext, this.deps.secret, `${memberId}:${key}`);
  }
  private async schedule() {
    const records = await this.deps.store.list<Stored>('');
    const dates = Array.from(records, ([key, value]) => key === 'owner' ? Infinity : key.startsWith('revoke:') ? Math.min(value.expiresAt, Date.now() + 1000) : value.expiresAt).filter(Number.isFinite);
    if (dates.length) await this.deps.store.alarm(Math.max(Date.now() + 1, Math.min(...dates)));
  }
  async begin(memberId: string, session: string, browser: string) {
    await this.owner(memberId);
    const state = randomSecret(), verifier = randomSecret();
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const url = await this.deps.oauth.authorize(state, challenge);
    await this.put(memberId, `pending:${state}`, { verifier, session, browser: await hash(browser) }, Date.now() + 600000);
    return { url };
  }
  async complete(memberId: string, session: string, browser: string, input: { state: string; code?: string; error?: string; issuer?: string }) {
    await this.owner(memberId);
    const key = `pending:${input.state}`, pending = await this.get<Pending>(memberId, key);
    if (!pending || pending.session !== session || pending.browser !== await hash(browser)) throw new AppError('MCP_STATE_INVALID', 400);
    await this.deps.store.delete(key);
    if (input.error) throw new AppError('MCP_AUTH_DENIED', 403);
    if (!input.code || input.issuer !== MCP_ISSUER) throw new AppError('MCP_ISSUER_INVALID', 400);
    const credential = { ...await this.deps.oauth.exchange(input.code, pending.verifier), authorizationId: randomSecret() };
    try {
      await this.validate(memberId, credential);
      await this.put(memberId, 'grant', credential, credential.refreshExpiresAt);
    } catch (error) {
      await this.put(memberId, `revoke:${randomSecret()}`, credential, credential.refreshExpiresAt);
      throw error;
    }
  }
  private async validate(memberId: string, credential: OAuthCredential): Promise<McpGrant> {
    const grant = { memberId, accessToken: credential.accessToken, expiresAt: credential.expiresAt, readOnlyTools: [...READ_ONLY_TOOLS] };
    await this.deps.verifyAccount(memberId, await this.deps.account(grant));
    return grant;
  }
  private async active(memberId: string): Promise<{ credential: Credential; grant: McpGrant }> {
    await this.owner(memberId);
    let credential = await this.get<Credential>(memberId, 'grant');
    if (!credential) throw new AppError('MCP_AUTH_REQUIRED', 403);
    try {
      if (credential.expiresAt <= Date.now() + 15000) {
        credential = { ...await this.deps.oauth.refresh(credential), authorizationId: credential.authorizationId };
        await this.put(memberId, 'grant', credential, credential.refreshExpiresAt);
      }
      return { credential, grant: await this.validate(memberId, credential) };
    } catch (error) {
      if (error instanceof AppError && ['MCP_AUTH_REVOKED', 'MCP_AUTH_EXPIRED', 'MCP_MEMBER_MISMATCH'].includes(error.code)) {
        await this.deps.store.delete('grant');
        await this.put(memberId, `revoke:${randomSecret()}`, credential, credential.refreshExpiresAt);
      }
      throw error;
    }
  }
  async grant(memberId: string): Promise<McpGrant> {
    const { credential } = await this.active(memberId);
    return { memberId, authorizationId: credential.authorizationId, expiresAt: credential.expiresAt, readOnlyTools: [...READ_ONLY_TOOLS] };
  }
  async list(memberId: string, authorizationId: string) {
    const { credential, grant } = await this.active(memberId);
    if (credential.authorizationId !== authorizationId) throw new AppError('MCP_AUTH_REVOKED', 403);
    return this.deps.mcp.list(grant);
  }
  async call(memberId: string, authorizationId: string, name: string, args: Record<string, unknown>) {
    const { credential, grant } = await this.active(memberId);
    if (credential.authorizationId !== authorizationId) throw new AppError('MCP_AUTH_REVOKED', 403);
    return this.deps.mcp.call(grant, name, args);
  }
  async revoke(memberId: string) {
    await this.owner(memberId);
    const credential = await this.get<OAuthCredential>(memberId, 'grant');
    if (credential) await this.put(memberId, `revoke:${randomSecret()}`, credential, credential.refreshExpiresAt);
    await this.deps.store.delete('grant');
    for (const key of (await this.deps.store.list('pending:')).keys()) await this.deps.store.delete(key);
    await this.alarm();
    return { pending: (await this.deps.store.list('revoke:')).size > 0 };
  }
  async alarm() {
    const memberId = await this.deps.store.get<string>('owner');
    if (!memberId) return;
    for (const [key, stored] of await this.deps.store.list<Stored>('')) {
      if (key === 'owner') continue;
      if (stored.expiresAt <= Date.now()) { await this.deps.store.delete(key); continue; }
      if (key.startsWith('revoke:')) {
        try { const credential = await this.get<OAuthCredential>(memberId, key); if (credential) await this.deps.oauth.revoke(credential); await this.deps.store.delete(key); }
        catch { /* 保留撤銷工作與下次確認時間 */ }
      }
    }
    await this.schedule();
  }
}
