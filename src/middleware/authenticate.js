import { AppError } from '../shared/errors.js';

export function createAuthenticate(authService, config) {
  return async function authenticate(req, _res, next) {
    const rawToken = req.cookies?.[config.SESSION_COOKIE_NAME];
    if (!rawToken) {
      throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
    }
    req.auth = await authService.authenticateSession(rawToken);
    next();
  };
}
