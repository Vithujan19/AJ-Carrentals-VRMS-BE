import { AppError } from '../shared/errors.js';

export function requirePermission(permission) {
  return function authorizePermission(req, _res, next) {
    if (!req.auth?.staff?.permissions.includes(permission)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action.');
    }
    next();
  };
}

export function requireAnyPermission(...permissions) {
  return function authorizeAnyPermission(req, _res, next) {
    if (!permissions.some((permission) => req.auth?.staff?.permissions.includes(permission))) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action.');
    }
    next();
  };
}
