import { z } from 'zod';

export const auditListSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    actorStaffUserId: z.string().uuid().optional(),
    action: z.string().trim().max(100).optional(),
    entityType: z.string().trim().min(1).max(80).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }).strict().refine(
    ({ from, to }) => !from || !to || from < to,
    { message: 'from must be earlier than to.' },
  ),
});
