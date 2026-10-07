import { createPrivateKey, randomBytes, sign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { loadConfig } from './config.js';

type Config = ReturnType<typeof loadConfig>;

export function loadSigningKey(path: string): KeyObject {
  const key = createPrivateKey(readFileSync(path));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('SIGNING_KEY_PATH must be an Ed25519 key');
  return key;
}

export async function sendHeartbeat(c: Config, key: KeyObject) {
  const body = { schoolCode: c.SCHOOL_CODE, timestamp: Date.now(), nonce: randomBytes(24).toString('base64url') };
  const signature = sign(null, Buffer.from(JSON.stringify(body)), key).toString('base64');
  const res = await fetch(new URL('/heartbeats', c.CENTRAL_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, signature }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`heartbeat rejected: ${res.status}`);
}

export function startHeartbeats(c: Config, key: KeyObject, everyMs = 60_000) {
  const beat = () => sendHeartbeat(c, key).catch(e => console.warn('Heartbeat failed', e.message));
  void beat();
  const timer = setInterval(beat, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
