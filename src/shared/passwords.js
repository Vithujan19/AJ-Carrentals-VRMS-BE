import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { AppError } from './errors.js';

const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
});

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new AppError(
      400,
      'INVALID_PASSWORD',
      'Password must be between 12 and 128 characters.',
    );
  }
}

export function hashPassword(password) {
  validatePassword(password);
  return argon2.hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(passwordHash, password) {
  return argon2.verify(passwordHash, password);
}

export function createOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
