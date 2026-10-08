import { z } from 'zod';
import 'dotenv/config';
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
/** The ONLY environment variables. Everything else lives in the database (see settings.ts). */
const schema = z.object({
 NODE_ENV: z.enum(['development','production','test']).default('development'),
 PORT: z.coerce.number().int().positive().default(34781),
 MONGO_URI: z.string().min(1),
});
export type Config = z.infer<typeof schema>;
let cached: Config | undefined;
export function loadConfig(): Config { return cached ??= schema.parse(process.env); }
/** Persistent volume for secrets that must never be in env or DB: ./data relative to the working dir (Docker: /app/data). */
let dir = resolve('data');
export const dataDir = () => dir;
/** Tests only. */
export function setDataDir(d: string) { dir = d; signingKey = undefined; pepper = undefined; }
export function persisted(name: string, make: () => string) {
 const p = join(dir, name);
 if (!existsSync(p)) { mkdirSync(dir, { recursive: true, mode: 0o700 }); writeFileSync(p, make(), { mode: 0o600, flag: 'wx' }); }
 return readFileSync(p, 'utf8');
}
let signingKey: KeyObject | undefined; let pepper: string | undefined;
/** Ed25519 federation key, generated on first boot and kept on the volume. */
export function schoolKey(): KeyObject {
 if (!signingKey) {
  const k = createPrivateKey(persisted('signing.pem', () => generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) as string));
  if (k.asymmetricKeyType !== 'ed25519') throw new Error('data/signing.pem must be an Ed25519 key');
  signingKey = k;
 }
 return signingKey;
}
export const schoolPublicKey = () => createPublicKey(schoolKey()).export({ type: 'spki', format: 'pem' }) as string;
export function otpPepper() { return pepper ??= persisted('otp-pepper', () => randomBytes(32).toString('base64url')).trim(); }
/** Central/public URLs must be HTTPS; plain http only for localhost outside production. */
export function safeOrigin(u: string) {
 const url = new URL(u);
 const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || (loadConfig().NODE_ENV !== 'production' && url.hostname === 'central');
 if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && loadConfig().NODE_ENV !== 'production')) throw new Error('HTTPS required');
 if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Must be a bare origin');
 return url.origin;
}
