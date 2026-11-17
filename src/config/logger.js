import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers.x-csrf-token',
      'password',
      'passwordHash',
      'token',
      'resetToken',
      'sessionToken',
    ],
    censor: '[REDACTED]',
  },
});
