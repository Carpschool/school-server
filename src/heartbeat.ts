import { randomBytes, sign } from 'node:crypto';
import { schoolKey } from './config.js';
import type { SettingsService } from './settings.js';
export async function sendHeartbeat(settings: SettingsService) {
  const s = await settings.get();
  if (!s.configured || !s.schoolCode || !s.centralUrl) return;
  const body = { schoolCode: s.schoolCode, timestamp: Date.now(), nonce: randomBytes(24).toString('base64url') };
  const signature = sign(null, Buffer.from(JSON.stringify(body)), schoolKey()).toString('base64');
  const res = await fetch(new URL('/heartbeats', s.centralUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, signature }), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`heartbeat rejected: ${res.status}`);
}
export function startHeartbeats(settings: SettingsService, everyMs = 60_000) {
  const beat = () => sendHeartbeat(settings).catch(e => console.warn('Heartbeat failed', e.message));
  void beat();
  const timer = setInterval(beat, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
