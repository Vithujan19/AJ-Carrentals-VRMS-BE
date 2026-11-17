import { z } from 'zod';

const password = z.string().min(12).max(128);

export const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(128),
  }).strict(),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: password,
  }).strict(),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(32).max(256),
    newPassword: password,
  }).strict(),
});
