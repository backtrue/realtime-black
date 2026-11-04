import { AppError } from './contracts';

export const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function unbase64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new AppError('AUTH_DATA_INVALID', 400);
  const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
  if (base64url(bytes) !== value) throw new AppError('AUTH_DATA_INVALID', 400);
  return bytes;
}
export const randomSecret = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
export function appOrigin(value: string | undefined): string {
  try {
    const url = new URL(value ?? '');
    if (url.origin !== value || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error();
    return url.origin;
  } catch { throw new AppError('AUTH_NOT_CONFIGURED'); }
}
function keyBytes(value: string | undefined) {
  try { const bytes = unbase64url(value ?? ''); if (bytes.length !== 32) throw new Error(); return bytes; }
  catch { throw new AppError('AUTH_NOT_CONFIGURED'); }
}
export async function loginState(key: string | undefined, origin: string, browser: string) {
  const payload = base64url(new TextEncoder().encode(JSON.stringify({ nonce: randomSecret(), browser: await hash(browser), audience: origin, expiresAt: Date.now() + 600000 })));
  const prefix = `voice1.${payload}`;
  const imported = await crypto.subtle.importKey('raw', keyBytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${prefix}.${base64url(new Uint8Array(await crypto.subtle.sign('HMAC', imported, new TextEncoder().encode(prefix))))}`;
}
export async function checkLoginState(state: string, key: string | undefined, origin: string, browser: string) {
  try {
    const [version, payload, signature, extra] = state.split('.');
    if (version !== 'voice1' || !payload || !signature || extra !== undefined || state.length > 2048) return false;
    const imported = await crypto.subtle.importKey('raw', keyBytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', imported, unbase64url(signature), new TextEncoder().encode(`${version}.${payload}`))) return false;
    const value = JSON.parse(new TextDecoder().decode(unbase64url(payload)));
    return value.audience === origin && value.browser === await hash(browser) && Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now() && value.expiresAt <= Date.now() + 600000;
  } catch { return false; }
}
export async function encrypt(value: unknown, secret: string | undefined, binding: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', keyBytes(secret), 'AES-GCM', false, ['encrypt']);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(binding) }, key, new TextEncoder().encode(JSON.stringify(value)));
  return `${base64url(iv)}.${base64url(new Uint8Array(data))}`;
}
export async function decrypt<T>(value: string, secret: string | undefined, binding: string): Promise<T> {
  try {
    const [iv, ciphertext, extra] = value.split('.'); if (!iv || !ciphertext || extra !== undefined) throw new Error();
    const key = await crypto.subtle.importKey('raw', keyBytes(secret), 'AES-GCM', false, ['decrypt']);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64url(iv), additionalData: new TextEncoder().encode(binding) }, key, unbase64url(ciphertext))));
  } catch { throw new AppError('AUTH_DATA_INVALID'); }
}
export function readCookie(request: Request, name: string): string | undefined {
  const values = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (values.length !== 1) return undefined;
  return values[0]!.slice(name.length + 1);
}
export const cookieName = (origin: string, suffix: string) => `${origin.startsWith('https:') ? '__Host-' : ''}realtime_${suffix}`;
export const cookieHeader = (origin: string, suffix: string, value: string, seconds: number) => `${cookieName(origin, suffix)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(seconds))}${origin.startsWith('https:') ? '; Secure' : ''}`;
