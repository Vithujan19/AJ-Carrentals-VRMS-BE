import { z } from 'zod';

const uuid = z.string().uuid();
const decimalAmount = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, 'Enter a valid monetary amount.');
const dateTime = z.string().datetime({ offset: true });

export const rentalPackageListSchema = z.object({
  query: z.object({
    includeInactive: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  }),
});

export const createRentalPackageSchema = z.object({
  body: z.object({
    code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/),
    name: z.string().trim().min(1).max(120),
    rentalPeriod: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
    durationCount: z.number().int().min(1).max(365).default(1),
    conditions: z.string().trim().max(12_000).nullable().optional(),
  }),
});

export const updateRentalPackageSchema = z.object({
  params: z.object({ packageId: uuid }),
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    conditions: z.string().trim().max(20_000).nullable().optional(),
    isActive: z.boolean().optional(),
  }).refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update.'),
});

const rateFields = {
  rentalPackageId: uuid,
  rentalPrice: decimalAmount,
  currency: z.string().trim().length(3).toUpperCase().default('LKR'),
  includedMileageKm: z.number().int().min(0).max(4_294_967_295),
  additionalKmRate: decimalAmount,
  securityDeposit: decimalAmount,
  effectiveFrom: dateTime,
  effectiveTo: dateTime.nullable().optional(),
};

function validateRateWindow(body, context) {
  if (body.effectiveTo && Date.parse(body.effectiveTo) <= Date.parse(body.effectiveFrom)) {
    context.addIssue({
      code: 'custom',
      path: ['effectiveTo'],
      message: 'Rate end must be after its start.',
    });
  }
}

export const createVehicleRateSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object(rateFields).superRefine(validateRateWindow),
});

export const updateVehicleRateSchema = z.object({
  params: z.object({ id: uuid, rateId: uuid }),
  body: z.object({
    rentalPrice: decimalAmount.optional(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    includedMileageKm: z.number().int().min(0).max(4_294_967_295).optional(),
    additionalKmRate: decimalAmount.optional(),
    securityDeposit: decimalAmount.optional(),
    effectiveFrom: dateTime.optional(),
    effectiveTo: dateTime.nullable().optional(),
    isActive: z.boolean().optional(),
  }).refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update.'),
});

export const vehicleRateListSchema = z.object({
  params: z.object({ id: uuid }),
  query: z.object({
    includeInactive: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  }),
});
