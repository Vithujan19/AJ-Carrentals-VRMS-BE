import 'dotenv/config';
import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  DATABASE_URL: z.string().min(1),
  FRONTEND_ORIGINS: z.string().min(1),
  CSRF_SECRET: z.string().min(32),
  SESSION_COOKIE_NAME: z.string().default('ajvrms_session'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28_800),
  SESSION_IDLE_TTL_SECONDS: z.coerce.number().int().positive().default(1_800),
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),
  COOKIE_SECURE: booleanFromString.default('false'),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(1_800),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanFromString.default('false'),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().default(''),
  VEHICLE_STORAGE_ROOT: z.string().trim().min(1).default('./var/private-uploads'),
  VEHICLE_IMAGE_MAX_BYTES: z.coerce.number().int().positive().max(52_428_800).default(10_485_760),
  VEHICLE_DOCUMENT_MAX_BYTES: z.coerce.number().int().positive().max(104_857_600).default(20_971_520),
  DOCUMENT_EXPIRY_WARNING_DAYS: z.coerce.number().int().min(1).max(365).default(30),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map(({ path, message }) => `${path.join('.')}: ${message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
  throw new Error('COOKIE_SECURE must be true in production');
}

if (
  parsed.data.NODE_ENV === 'production' &&
  !parsed.data.SESSION_COOKIE_NAME.startsWith('__Host-')
) {
  throw new Error('Production session cookie name must use the __Host- prefix');
}

if (parsed.data.COOKIE_SAME_SITE === 'none' && !parsed.data.COOKIE_SECURE) {
  throw new Error('COOKIE_SECURE must be true when COOKIE_SAME_SITE=none');
}

export const config = Object.freeze({
  ...parsed.data,
  frontendOrigins: parsed.data.FRONTEND_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  smtpConfigured: Boolean(
    parsed.data.SMTP_HOST &&
      parsed.data.SMTP_USER &&
      parsed.data.SMTP_PASSWORD &&
      parsed.data.SMTP_FROM,
  ),
});
