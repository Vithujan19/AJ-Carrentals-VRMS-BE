import { z } from 'zod';

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
const money = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, 'Enter a valid amount with at most two decimal places.');
const phone = z.string().trim().min(7).max(32);
const email = z.string().trim().email().max(254).optional().or(z.literal(''));
const status = z.enum([
  'PENDING',
  'UNDER_REVIEW',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
  'NO_SHOW',
  'HANDED_OVER',
  'RETURNED',
  'COMPLETED',
]);
const pageFields = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

const scheduleFields = {
  vehicleId: uuid,
  rentalPackageId: uuid,
  vehicleRateId: uuid,
  pickupAt: dateTime,
  returnAt: dateTime,
  pickupLocation: z.string().trim().max(255).nullable().optional(),
  returnLocation: z.string().trim().max(255).nullable().optional(),
};

const customerFields = {
  fullName: z.string().trim().min(1).max(160),
  mobileNumber: phone,
  email,
};

const adjustment = z.object({
  chargeType: z.enum([
    'EXTRA_KILOMETRE',
    'LATE_RETURN',
    'DAMAGE',
    'CLEANING',
    'DELIVERY',
    'OTHER',
    'DISCOUNT',
  ]),
  direction: z.enum(['DEBIT', 'CREDIT']),
  amount: money,
  description: z.string().trim().min(1).max(1000),
}).superRefine((charge, context) => {
  if ((charge.chargeType === 'DISCOUNT') !== (charge.direction === 'CREDIT')) {
    context.addIssue({
      code: 'custom',
      path: ['direction'],
      message: 'Discounts must be credits; other adjustments must be debits.',
    });
  }
});

function validateSchedule(body, context) {
  const pickupAt = Date.parse(body.pickupAt);
  const returnAt = Date.parse(body.returnAt);
  if (returnAt <= pickupAt) {
    context.addIssue({
      code: 'custom',
      path: ['returnAt'],
      message: 'Return must be later than pickup.',
    });
  }
}

export const bookingListSchema = z.object({
  query: z.object({
    ...pageFields,
    search: z.string().trim().max(100).optional(),
    status: status.optional(),
    vehicleId: uuid.optional(),
    customerId: uuid.optional(),
    from: dateTime.optional(),
    to: dateTime.optional(),
    sortBy: z.enum(['createdAt', 'pickupAt', 'returnAt', 'reference']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }).superRefine((query, context) => {
    if (Boolean(query.from) !== Boolean(query.to)) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'Both date-range endpoints are required.' });
    } else if (query.from && query.to && Date.parse(query.from) >= Date.parse(query.to)) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'Date range end must follow its start.' });
    }
  }),
});

export const bookingCalendarSchema = z.object({
  query: z.object({
    from: dateTime,
    to: dateTime,
    status: status.optional(),
    vehicleId: uuid.optional(),
    view: z.enum(['day', 'week', 'month']).default('month'),
  }).superRefine((query, context) => {
    const duration = Date.parse(query.to) - Date.parse(query.from);
    if (duration <= 0 || duration > 93 * 24 * 60 * 60 * 1000) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'Choose a calendar range up to 93 days.' });
    }
  }),
});

export const availabilitySchema = z.object({
  query: z.object({
    ...pageFields,
    pickupAt: dateTime,
    returnAt: dateTime,
    search: z.string().trim().max(100).optional(),
    vehicleId: uuid.optional(),
  }).superRefine((query, context) => validateSchedule({
    pickupAt: query.pickupAt,
    returnAt: query.returnAt,
  }, context)),
});

export const staffCreateBookingSchema = z.object({
  body: z.object({
    ...scheduleFields,
    customerId: uuid.optional(),
    customer: z.object(customerFields).optional(),
    source: z.enum(['STAFF_PORTAL', 'PHONE', 'WHATSAPP', 'OTHER']).default('STAFF_PORTAL'),
    status: z.enum(['PENDING', 'CONFIRMED']).default('PENDING'),
    customerNotes: z.string().trim().max(4000).nullable().optional(),
    internalNotes: z.string().trim().max(4000).nullable().optional(),
    adjustments: z.array(adjustment).max(20).default([]),
  }).superRefine((body, context) => {
    validateSchedule(body, context);
    if (Boolean(body.customerId) === Boolean(body.customer)) {
      context.addIssue({
        code: 'custom',
        path: ['customerId'],
        message: 'Choose an existing customer or provide new customer details.',
      });
    }
  }),
});

export const publicCreateBookingSchema = z.object({
  body: z.object({
    ...scheduleFields,
    ...customerFields,
    customerNotes: z.string().trim().max(4000).nullable().optional(),
    whatsappConsent: z.boolean().default(false),
    website: z.string().max(0).optional(),
  }).superRefine(validateSchedule),
});

export const idempotencyKeySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/);

export const publicBookingTokenSchema = z.object({
  params: z.object({ reference: z.string().trim().min(1).max(40) }),
  body: z.object({ token: z.string().trim().min(16).max(200) }),
});

export const publicVehicleCalendarSchema = z.object({
  params: z.object({ id: uuid }),
  query: z.object({ from: dateTime, to: dateTime }).superRefine((query, context) => {
    const from = new Date(query.from).getTime();
    const to = new Date(query.to).getTime();
    if (to <= from) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'The end must be after the start.' });
    } else if (to - from > 100 * 24 * 60 * 60 * 1000) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'Choose a range of at most 100 days.' });
    }
  }),
});

export const updateBookingSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    ...Object.fromEntries(Object.entries(scheduleFields).map(([key, schema]) => [key, schema.optional()])),
    customerNotes: z.string().trim().max(4000).nullable().optional(),
    internalNotes: z.string().trim().max(4000).nullable().optional(),
    scheduleChangeReason: z.string().trim().min(1).max(1000).optional(),
  }).superRefine((body, context) => {
    if (body.pickupAt && body.returnAt) validateSchedule(body, context);
    const scheduleChanged = [
      'vehicleId',
      'rentalPackageId',
      'vehicleRateId',
      'pickupAt',
      'returnAt',
    ].some((key) => body[key] !== undefined);
    if (scheduleChanged && !body.scheduleChangeReason) {
      context.addIssue({
        code: 'custom',
        path: ['scheduleChangeReason'],
        message: 'A reason is required when changing booking dates or vehicle.',
      });
    }
    if (Object.keys(body).length === 0) {
      context.addIssue({ code: 'custom', message: 'Provide at least one field to update.' });
    }
  }),
});

export const bookingIdSchema = z.object({ params: z.object({ id: uuid }) });
export const bookingReasonSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({ reason: z.string().trim().min(1).max(1000) }),
});

export const handoverSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    startingOdometerKm: z.number().int().min(0).max(4_294_967_295),
    startingFuelPercent: z.string().regex(/^(?:100(?:\.0{1,2})?|(?:\d|[1-9]\d)(?:\.\d{1,2})?)$/),
    handedOverAt: dateTime.optional(),
    conditionSummary: z.string().trim().max(12000).nullable().optional(),
  }),
});

export const returnSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    endingOdometerKm: z.number().int().min(0).max(4_294_967_295),
    endingFuelPercent: z.string().regex(/^(?:100(?:\.0{1,2})?|(?:\d|[1-9]\d)(?:\.\d{1,2})?)$/),
    returnedAt: dateTime.optional(),
    conditionSummary: z.string().trim().max(12000).nullable().optional(),
  }),
});

export const customerSearchSchema = z.object({
  query: z.object({
    search: z.string().trim().min(2).max(100),
    ...pageFields,
  }),
});

export const publicLookupSchema = z.object({
  body: z.object({
    reference: z.string().trim().regex(/^AJR-\d{4}-\d{6,}$/),
    token: z.string().min(32).max(128),
  }),
});
