import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requestAuditContext } from '../../shared/audit.js';
import {
  clearCsrfCookie,
  clearSessionCookie,
  issueCsrfCookie,
  setSessionCookie,
} from '../../middleware/csrf.js';
import { validate } from '../../middleware/validate.js';
import {
  changePasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from './auth.schemas.js';

function createIpLimiter({ limit, windowMs, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message } },
  });
}

export function createAuthRouter({ authService, authenticate, config }) {
  const router = Router();
  const loginLimiter = createIpLimiter({
    limit: 8,
    windowMs: 15 * 60 * 1000,
    message: 'Too many sign-in attempts. Try again later.',
  });
  const resetLimiter = createIpLimiter({
    limit: 5,
    windowMs: 15 * 60 * 1000,
    message: 'Too many password token attempts. Try again later.',
  });

  router.get('/csrf', (_req, res) => {
    const token = issueCsrfCookie(res, config);
    res.json({ data: { csrfToken: token } });
  });

  router.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
    const { email, password } = req.validated.body;
    const result = await authService.login({
      email,
      password,
      auditContext: requestAuditContext(req),
    });
    setSessionCookie(res, result.rawToken, config);
    const csrfToken = issueCsrfCookie(res, config);
    res.json({ data: { user: result.staff, csrfToken } });
  });

  router.post('/logout', async (req, res) => {
    await authService.logout(
      req.cookies?.[config.SESSION_COOKIE_NAME],
      requestAuditContext(req),
    );
    clearSessionCookie(res, config);
    clearCsrfCookie(res, config);
    res.status(204).end();
  });

  router.post('/logout-all', authenticate, async (req, res) => {
    await authService.logoutAll(req.auth.staff.id, requestAuditContext(req));
    clearSessionCookie(res, config);
    clearCsrfCookie(res, config);
    res.status(204).end();
  });

  router.get('/me', authenticate, async (req, res) => {
    res.json({ data: { user: req.auth.staff } });
  });

  router.post(
    '/change-password',
    authenticate,
    validate(changePasswordSchema),
    async (req, res) => {
      const { currentPassword, newPassword } = req.validated.body;
      const result = await authService.changePassword({
        staffUserId: req.auth.staff.id,
        currentPassword,
        newPassword,
        auditContext: requestAuditContext(req),
      });
      setSessionCookie(res, result.rawToken, config);
      const csrfToken = issueCsrfCookie(res, config);
      res.json({ data: { message: 'Password changed.', csrfToken } });
    },
  );

  router.post(
    '/reset-password',
    resetLimiter,
    validate(resetPasswordSchema),
    async (req, res) => {
      await authService.resetPassword({
        ...req.validated.body,
        auditContext: requestAuditContext(req),
      });
      clearSessionCookie(res, config);
      res.json({ data: { message: 'Password reset complete. Sign in with your new password.' } });
    },
  );

  return router;
}
