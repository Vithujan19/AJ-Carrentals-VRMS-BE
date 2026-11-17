import { z } from 'zod';

const uuid = z.string().uuid();

export const staffListSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(120).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE', 'PENDING_SETUP']).optional(),
  }).strict(),
});

export const staffIdSchema = z.object({
  params: z.object({ id: uuid }).strict(),
});

export const createStaffSchema = z.object({
  body: z.object({
    displayName: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(254),
    mobileNumber: z.string().trim().min(7).max(32).nullable().optional(),
    roleIds: z.array(uuid).min(1).max(10),
  }).strict(),
});

export const updateStaffProfileSchema = z.object({
  params: z.object({ id: uuid }).strict(),
  body: z.object({
    displayName: z.string().trim().min(1).max(160).optional(),
    email: z.string().trim().email().max(254).optional(),
    mobileNumber: z.string().trim().min(7).max(32).nullable().optional(),
  }).strict(),
});

export const updateStaffStatusSchema = z.object({
  params: z.object({ id: uuid }).strict(),
  body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']) }).strict(),
});

export const updateStaffRolesSchema = z.object({
  params: z.object({ id: uuid }).strict(),
  body: z.object({ roleIds: z.array(uuid).min(1).max(10) }).strict(),
});

export const staffSessionParamsSchema = z.object({
  params: z.object({ id: uuid, sessionId: uuid }).strict(),
});

export const vehicleAssignmentParamsSchema = z.object({
  params: z.object({ id: uuid, assignmentId: uuid }).strict(),
});

export const createVehicleAssignmentSchema = z.object({
  params: z.object({ id: uuid }).strict(),
  body: z.object({ vehicleId: uuid }).strict(),
});
