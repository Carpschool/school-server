import { z } from 'zod';
import 'dotenv/config';
const positive = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const schema = z.object({
 NODE_ENV: z.enum(['development','production','test']).default('development'), PORT: positive(34781),
 MONGO_URI: z.string().min(1), SCHOOL_CODE: z.string().regex(/^[a-z0-9-]{2,40}$/), OFFICIAL_NAME: z.string().min(1),
 CENTRAL_URL: z.string().url(), CENTRAL_ISSUER: z.string().min(1), PUBLIC_URL: z.string().url(),
 SIGNING_KEY_PATH: z.string().min(1), OTP_PEPPER: z.string().min(32),
 ALLOWED_EMAIL_DOMAINS: z.string().min(1), MAX_HOMES_PER_USER: positive(5), MAX_USERS_PER_EDU_EMAIL: positive(1),
 MAX_CARPOOL_STUDENTS: z.coerce.number().int().min(1).max(12).default(4),
 EMAIL_PROVIDER: z.enum(['gmail','test']), GMAIL_USER: z.string().optional(), GMAIL_OAUTH_CLIENT_ID: z.string().optional(),
 GMAIL_OAUTH_CLIENT_SECRET: z.string().optional(), GMAIL_OAUTH_REFRESH_TOKEN: z.string().optional(),
 CORS_ORIGINS: z.string().default(''), CAMPUS_LATITUDE: z.coerce.number().min(-90).max(90), CAMPUS_LONGITUDE: z.coerce.number().min(-180).max(180),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(): Config {
 const c = schema.parse(process.env);
 if(c.EMAIL_PROVIDER === 'test' && c.NODE_ENV !== 'test') throw new Error('Test mailer forbidden outside tests');
 if(c.EMAIL_PROVIDER === 'gmail') for(const key of ['GMAIL_USER','GMAIL_OAUTH_CLIENT_ID','GMAIL_OAUTH_CLIENT_SECRET','GMAIL_OAUTH_REFRESH_TOKEN'] as const) if(!c[key]) throw new Error('Missing '+key);
 const central = new URL(c.CENTRAL_URL);
 if(central.protocol !== 'https:' && !['localhost','127.0.0.1','central'].includes(central.hostname)) throw new Error('CENTRAL_URL requires HTTPS');
 return c;
}
