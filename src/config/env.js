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
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(14_400),
  SESSION_IDLE_TTL_SECONDS: z.coerce.number().int().positive().default(14_400),
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
  BUSINESS_NAME: z.string().trim().min(1).default('AJ Car Rentals'),
  WHATSAPP_BUSINESS_NUMBER: z.string().trim().default(''),
  WHATSAPP_PROVIDER: z.enum(['click_to_chat', 'cloud_api']).default('click_to_chat'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().trim().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().trim().default(''),
  WHATSAPP_APP_SECRET: z.string().trim().default(''),
  WHATSAPP_VERIFY_TOKEN: z.string().trim().default(''),
  WHATSAPP_API_VERSION: z.string().trim().default('v21.0'),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().trim().default('en'),
  WHATSAPP_CONFIRMATION_TEMPLATE: z.string().trim().default('booking_confirmed'),
  WHATSAPP_DEFAULT_COUNTRY_CODE: z.string().trim().regex(/^\d{1,4}$/).default('94'),
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

const whatsappCloudConfigured = Boolean(
  parsed.data.WHATSAPP_PROVIDER === 'cloud_api' &&
    parsed.data.WHATSAPP_PHONE_NUMBER_ID &&
    parsed.data.WHATSAPP_ACCESS_TOKEN,
);

export const config = Object.freeze({
  ...parsed.data,
  whatsappCloudConfigured,
  whatsappWebhookConfigured: Boolean(
    parsed.data.WHATSAPP_APP_SECRET && parsed.data.WHATSAPP_VERIFY_TOKEN,
  ),
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
