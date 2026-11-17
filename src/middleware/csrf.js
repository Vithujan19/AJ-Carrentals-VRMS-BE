import { createHmac, randomBytes } from 'node:crypto';
import { AppError } from '../shared/errors.js';
import { safeEqual } from '../shared/passwords.js';

export const CSRF_COOKIE_NAME = 'ajvrms_csrf';

function csrfTokenSignature(value, config) {
  return createHmac('sha256', config.CSRF_SECRET).update(value).digest('base64url');
}

function isValidCsrfToken(token, config) {
  if (typeof token !== 'string') {
    return false;
  }
  const [value, signature, extra] = token.split('.');
  if (!value || !signature || extra !== undefined) {
    return false;
  }
  return safeEqual(signature, csrfTokenSignature(value, config));
}

function cookieOptions(config, httpOnly) {
  return {
    httpOnly,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
    path: '/',
    maxAge: config.SESSION_TTL_SECONDS * 1000,
  };
}

export function issueCsrfCookie(res, config) {
  const value = randomBytes(32).toString('base64url');
  const token = `${value}.${csrfTokenSignature(value, config)}`;
  res.cookie(CSRF_COOKIE_NAME, token, cookieOptions(config, false));
  return token;
}

export function setSessionCookie(res, token, config) {
  res.cookie(config.SESSION_COOKIE_NAME, token, cookieOptions(config, true));
}

export function clearSessionCookie(res, config) {
  res.clearCookie(config.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
    path: '/',
  });
}

export function clearCsrfCookie(res, config) {
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
    path: '/',
  });
}

export function createCsrfProtection(config) {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  const allowedOrigins = new Set(config.frontendOrigins);
  return function csrfProtection(req, _res, next) {
    if (safeMethods.has(req.method)) {
      next();
      return;
    }

    const origin = req.get('origin');
    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
    const headerToken = req.get('x-csrf-token');
    if (
      !origin ||
      !allowedOrigins.has(origin) ||
      !cookieToken ||
      !headerToken ||
      !safeEqual(cookieToken, headerToken) ||
      !isValidCsrfToken(cookieToken, config)
    ) {
      throw new AppError(403, 'CSRF_VALIDATION_FAILED', 'Request could not be verified.');
    }
    next();
  };
}
