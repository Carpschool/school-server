import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const path = process.env.SIGNING_KEY_PATH || 'keys/school-signing.pem';
if (existsSync(path)) {
  console.error(`refusing to overwrite ${path}`);
  process.exit(1);
}
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
const { privateKey } = generateKeyPairSync('ed25519');
writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
console.log(`wrote ${path}`);
