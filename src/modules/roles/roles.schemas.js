import { z } from 'zod';

export const updateRolePermissionsSchema = z.object({
  params: z.object({ id: z.string().uuid() }).strict(),
  body: z.object({
    permissionCodes: z.array(z.string().trim().min(1).max(100)).max(100),
  }).strict(),
});
