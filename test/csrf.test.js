import { describe, expect, it, vi } from 'vitest';
import {
  CSRF_COOKIE_NAME,
  createCsrfProtection,
  issueCsrfCookie,
} from '../src/middleware/csrf.js';
import { AppError } from '../src/shared/errors.js';

const config = {
  CSRF_SECRET: 'test-secret-with-more-than-thirty-two-characters',
  COOKIE_SECURE: false,
  COOKIE_SAME_SITE: 'lax',
  SESSION_TTL_SECONDS: 3600,
  frontendOrigins: ['http://localhost:5173'],
};

function requestFor(token, origin = 'http://localhost:5173') {
  return {
    method: 'POST',
    cookies: { [CSRF_COOKIE_NAME]: token },
    get(name) {
      return {
        origin,
        'x-csrf-token': token,
      }[name.toLowerCase()];
    },
  };
}

describe('CSRF protection', () => {
  it('accepts a matching signed token from an allowed origin', () => {
    const cookie = vi.fn();
    const response = { cookie };
    const token = issueCsrfCookie(response, config);
    const next = vi.fn();

    createCsrfProtection(config)(requestFor(token), {}, next);

    expect(cookie).toHaveBeenCalledWith(
      CSRF_COOKIE_NAME,
      token,
      expect.objectContaining({ httpOnly: false }),
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects forged tokens even when cookie and header match', () => {
    const next = vi.fn();

    expect(() => createCsrfProtection(config)(
      requestFor('attacker-controlled.value'),
      {},
      next,
    )).toThrow(AppError);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests without an allowlisted origin', () => {
    const response = { cookie: vi.fn() };
    const token = issueCsrfCookie(response, config);

    expect(() => createCsrfProtection(config)(
      requestFor(token, 'https://other.example'),
      {},
      vi.fn(),
    )).toThrow(expect.objectContaining({ code: 'CSRF_VALIDATION_FAILED' }));
  });
});
