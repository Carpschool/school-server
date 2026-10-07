// One-time: move a legacy env-configured school into the DB + data volume.
// usage: node --env-file=old.env scripts/migrate-env.mjs   (run from the school-server dir)
import { MongoClient } from 'mongodb';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
const e = process.env; const dir = 'data'; mkdirSync(dir, { recursive: true, mode: 0o700 });
if (e.SIGNING_KEY_PATH && !existsSync(dir + '/signing.pem')) copyFileSync(e.SIGNING_KEY_PATH, dir + '/signing.pem');
if (e.OTP_PEPPER && !existsSync(dir + '/otp-pepper')) writeFileSync(dir + '/otp-pepper', e.OTP_PEPPER, { mode: 0o600 });
const c = await MongoClient.connect(e.MONGO_URI); const col = c.db().collection('settings');
const cur = (await col.findOne({ key: 'school' }))?.value || {}; const legacy = (await col.findOne({ key: 'domains' }))?.value;
const domains = cur.domains || legacy || (e.ALLOWED_EMAIL_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const m = cur.mailer || {};
const value = { ...cur, configured: true, schoolCode: e.SCHOOL_CODE, centralUrl: new URL(e.CENTRAL_ISSUER || e.CENTRAL_URL).origin, publicUrl: new URL(e.PUBLIC_URL).origin,
  officialName: cur.officialName || e.OFFICIAL_NAME, corsOrigins: cur.corsOrigins || (e.CORS_ORIGINS || '').split(',').filter(Boolean),
  campus: cur.campus || { name: e.OFFICIAL_NAME, address: '', latitude: +e.CAMPUS_LATITUDE, longitude: +e.CAMPUS_LONGITUDE },
  emailRules: cur.emailRules || domains.map(value => ({ type: 'domain', value })),
  limits: cur.limits || { maxCarpoolStudents: +e.MAX_CARPOOL_STUDENTS || 4, maxHomesPerUser: +e.MAX_HOMES_PER_USER || 3, maxUsersPerEduEmail: +e.MAX_USERS_PER_EDU_EMAIL || 1 },
  mailer: { provider: m.provider || e.EMAIL_PROVIDER || 'gmail', fromName: m.fromName ?? 'Carpschool', gmailUser: m.gmailUser || e.GMAIL_USER, clientId: m.clientId || e.GMAIL_OAUTH_CLIENT_ID, clientSecret: m.clientSecret || e.GMAIL_OAUTH_CLIENT_SECRET, refreshToken: m.refreshToken || e.GMAIL_OAUTH_REFRESH_TOKEN } };
delete value.domains; delete value.email; for (const k of Object.keys(value.mailer)) if (value.mailer[k] === undefined) delete value.mailer[k];
await col.updateOne({ key: 'school' }, { $set: { value } }, { upsert: true }); await col.deleteOne({ key: 'domains' });
console.log('migrated', value.schoolCode, 'rules', value.emailRules.length, 'cors', value.corsOrigins.length); await c.close();
