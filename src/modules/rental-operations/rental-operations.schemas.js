import { z } from 'zod';

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
const money = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/);
const fuelPercent = z.string().regex(/^(?:100(?:\.0{1,2})?|(?:\d|[1-9]\d)(?:\.\d{1,2})?)$/);
const pageFields = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

const inspectionItem = z.object({
  componentCode: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  condition: z.enum(['GOOD', 'MINOR_ISSUE', 'DAMAGED', 'NOT_APPLICABLE']),
  notes: z.string().trim().max(1000).nullable().optional(),
});

const handoverAccessory = z.object({
  code: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  supplied: z.boolean(),
  quantity: z.number().int().min(0).max(100),
  condition: z.enum(['GOOD', 'MINOR_ISSUE', 'DAMAGED', 'NOT_APPLICABLE']),
  notes: z.string().trim().max(500).nullable().optional(),
});

const returnAccessory = z.object({
  handoverAccessoryId: uuid,
  quantityReturned: z.number().int().min(0).max(100),
  notes: z.string().trim().max(500).nullable().optional(),
});

const reportedDamage = z.object({
  category: z.enum(['BODY', 'GLASS', 'TYRE', 'INTERIOR', 'MECHANICAL', 'ACCESSORY', 'OTHER']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  origin: z.enum(['PRE_EXISTING', 'NEW']),
  description: z.string().trim().min(1).max(2000),
  location: z.string().trim().max(160).nullable().optional(),
  estimatedRepairCost: money.nullable().optional(),
});

export const handoverPayloadSchema = z.object({
  actualAt: dateTime,
  odometerKm: z.number().int().min(0).max(4_294_967_295),
  fuelPercent,
  notes: z.string().trim().max(2000).nullable().optional(),
  customerRepresentative: z.string().trim().max(160).nullable().optional(),
  inspectionItems: z.array(inspectionItem).min(1).max(60),
  accessories: z.array(handoverAccessory).max(60).default([]),
  damages: z.array(reportedDamage).max(30).default([]).superRefine((damages, context) => {
    damages.forEach((damage, index) => {
      if (damage.origin !== 'PRE_EXISTING') {
        context.addIssue({
          code: 'custom',
          path: [index, 'origin'],
          message: 'Handover damage must be recorded as pre-existing.',
        });
      }
    });
  }),
}).superRefine((payload, context) => {
  const accessories = new Set(payload.accessories.map(({ code }) => code));
  if (accessories.size !== payload.accessories.length) {
    context.addIssue({ code: 'custom', path: ['accessories'], message: 'Each accessory can be recorded only once.' });
  }
  payload.accessories.forEach((accessory, index) => {
    if (!accessory.supplied && accessory.quantity !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['accessories', index, 'quantity'],
        message: 'Quantity must be zero when an accessory was not supplied.',
      });
    }
    if (accessory.supplied && accessory.quantity === 0) {
      context.addIssue({
        code: 'custom',
        path: ['accessories', index, 'quantity'],
        message: 'Enter a positive quantity for a supplied accessory.',
      });
    }
  });
});

export const returnPayloadSchema = z.object({
  actualAt: dateTime,
  odometerKm: z.number().int().min(0).max(4_294_967_295),
  fuelPercent,
  notes: z.string().trim().max(2000).nullable().optional(),
  returnLocation: z.string().trim().max(255).nullable().optional(),
  inspectionItems: z.array(inspectionItem).min(1).max(60),
  returnAccessories: z.array(returnAccessory).default([]),
  damages: z.array(reportedDamage).max(30).default([]),
  maintenanceRequired: z.boolean().default(false),
  maintenanceReason: z.string().trim().max(1000).nullable().optional(),
}).superRefine((payload, context) => {
  if (payload.maintenanceRequired && !payload.maintenanceReason?.trim()) {
    context.addIssue({
      code: 'custom',
      path: ['maintenanceReason'],
      message: 'A reason is required when the vehicle needs maintenance.',
    });
  }
});

const payloadFields = {
  actualAt: dateTime.optional(),
  odometerKm: z.number().int().min(0).max(4_294_967_295).optional(),
  fuelPercent: fuelPercent.optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  customerRepresentative: z.string().trim().max(160).nullable().optional(),
  returnLocation: z.string().trim().max(255).nullable().optional(),
  inspectionItems: z.array(inspectionItem).max(60).optional(),
  accessories: z.array(handoverAccessory).max(60).optional(),
  returnAccessories: z.array(returnAccessory).max(60).optional(),
  damages: z.array(reportedDamage).max(30).optional(),
  maintenanceRequired: z.boolean().optional(),
  maintenanceReason: z.string().trim().max(1000).nullable().optional(),
};

const params = z.object({ bookingId: uuid });

export const bookingOperationParamsSchema = z.object({ params });
export const operationParamsSchema = z.object({
  params: params.extend({ operation: z.enum(['handover', 'return']) }),
});
export const draftSchema = z.object({
  params: params.extend({ operation: z.enum(['handover', 'return']) }),
  body: z.object({
    version: z.number().int().positive().optional(),
    payload: z.object(payloadFields).partial(),
  }),
});
export const completeOperationSchema = z.object({
  params: params.extend({ operation: z.enum(['handover', 'return']) }),
  body: z.object({
    version: z.number().int().positive(),
    customerAcknowledged: z.literal(true),
  }),
});
export const draftPhotoParamsSchema = z.object({
  params: params.extend({ operation: z.enum(['handover', 'return']) }),
});
export const photoParamsSchema = z.object({
  params: params.extend({ photoId: uuid }),
});

export const customerVerificationSchema = z.object({
  params,
  body: z.object({
    idempotencyKey: z.string().trim().min(16).max(100),
    status: z.enum([
      'PENDING_VERIFICATION',
      'VERIFIED',
      'REJECTED',
      'EXPIRED',
    ]),
    checks: z.object({
      identityVerified: z.boolean(),
      licenceVerified: z.boolean(),
      contactVerified: z.boolean(),
      documentsReviewed: z.array(uuid).max(20),
    }),
    notes: z.string().trim().max(2000).nullable().optional(),
    rejectionReason: z.string().trim().min(1).max(1000).optional(),
  }).superRefine((body, context) => {
    if (new Set(body.checks.documentsReviewed).size !== body.checks.documentsReviewed.length) {
      context.addIssue({
        code: 'custom',
        path: ['checks', 'documentsReviewed'],
        message: 'A customer document can be marked reviewed only once.',
      });
    }
    if (body.status === 'REJECTED' && !body.rejectionReason) {
      context.addIssue({
        code: 'custom',
        path: ['rejectionReason'],
        message: 'A reason is required when verification is rejected.',
      });
    }
    if (body.status === 'VERIFIED' && (
      !body.checks.identityVerified ||
      !body.checks.contactVerified
    )) {
      context.addIssue({
        code: 'custom',
        path: ['checks'],
        message: 'Complete required customer verification checks before marking verified.',
      });
    }
  }),
});

export const dashboardSchema = z.object({
  query: z.object({
    ...pageFields,
    search: z.string().trim().max(100).optional(),
    vehicleId: uuid.optional(),
    bucket: z.enum(['ACTIVE', 'DUE_TODAY', 'OVERDUE', 'UPCOMING']).default('ACTIVE'),
  }),
});

export const createChargeSchema = z.object({
  params,
  body: z.object({
    idempotencyKey: z.string().trim().min(16).max(100),
    chargeType: z.enum([
      'DISCOUNT',
      'EXTRA_KILOMETRE',
      'LATE_RETURN',
      'DAMAGE',
      'CLEANING',
      'DELIVERY',
      'OTHER',
    ]),
    direction: z.enum(['DEBIT', 'CREDIT']),
    quantity: money,
    unitPrice: money,
    description: z.string().trim().min(1).max(1000),
    reason: z.string().trim().min(1).max(1000),
  }).superRefine((body, context) => {
    if ((body.chargeType === 'DISCOUNT') !== (body.direction === 'CREDIT')) {
      context.addIssue({
        code: 'custom',
        path: ['direction'],
        message: 'Discounts must be credits; other charge types must be debits.',
      });
    }
  }),
});

export const chargeDecisionSchema = z.object({
  params: z.object({ chargeId: uuid }),
  body: z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().min(1).max(1000),
  }),
});

export const damageListSchema = z.object({
  query: z.object({
    ...pageFields,
    status: z.enum(['OPEN', 'ASSESSED', 'RESOLVED', 'WAIVED']).optional(),
    chargeApprovalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
    search: z.string().trim().max(100).optional(),
  }),
});

export const damageParamsSchema = z.object({ params: z.object({ damageId: uuid }) });
export const createDamageSchema = z.object({
  params,
  body: reportedDamage.extend({
    inspectionId: uuid,
  }),
});
export const damageDecisionSchema = z.object({
  params: z.object({ damageId: uuid }),
  body: z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().min(1).max(1000),
    approvedChargeAmount: money.optional(),
  }).superRefine((body, context) => {
    if (body.decision === 'APPROVED' && body.approvedChargeAmount === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['approvedChargeAmount'],
        message: 'Enter the approved customer charge amount.',
      });
    }
  }),
});

export const createPaymentSchema = z.object({
  params,
  body: z.object({
    idempotencyKey: z.string().trim().min(16).max(100),
    purpose: z.enum(['ADVANCE', 'PARTIAL', 'FINAL', 'SECURITY_DEPOSIT', 'OTHER']),
    method: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER']),
    amount: money,
    currency: z.string().length(3).regex(/^[A-Z]{3}$/).default('LKR'),
    reference: z.string().trim().max(160).nullable().optional(),
    transactionAt: dateTime.optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    allocations: z.array(z.object({
      allocationType: z.enum(['RENTAL', 'SECURITY_DEPOSIT', 'OTHER']),
      amount: money,
    })).min(1).max(3).refine(
      (allocations) => new Set(allocations.map(({ allocationType }) => allocationType)).size === allocations.length,
      'Payment allocation types must be unique.',
    ),
  }),
});

export const refundSchema = z.object({
  params: z.object({ bookingId: uuid, paymentId: uuid }),
  body: z.object({
    idempotencyKey: z.string().trim().min(16).max(100),
    method: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER']),
    amount: money,
    reference: z.string().trim().max(160).nullable().optional(),
    transactionAt: dateTime.optional(),
    reason: z.string().trim().min(1).max(1000),
    allocations: z.array(z.object({
      allocationType: z.enum(['RENTAL', 'SECURITY_DEPOSIT', 'OTHER']),
      amount: money,
    })).min(1).max(3).refine(
      (allocations) => new Set(allocations.map(({ allocationType }) => allocationType)).size === allocations.length,
      'Refund allocation types must be unique.',
    ),
  }),
});

export const depositApplicationSchema = z.object({
  params,
  body: z.object({
    idempotencyKey: z.string().trim().min(16).max(100),
    chargeId: uuid,
    amount: money,
    reason: z.string().trim().min(1).max(1000),
  }),
});

export const paymentCorrectionSchema = z.object({
  params: z.object({ bookingId: uuid, paymentId: uuid }),
  body: z.object({ reason: z.string().trim().min(1).max(1000) }),
});

export const policyConfigurationSchema = z.object({
  body: z.object({
    requiredCustomerDocumentTypes: z.array(z.enum([
      'NIC_FRONT',
      'NIC_BACK',
      'DRIVING_LICENCE_FRONT',
      'DRIVING_LICENCE_BACK',
      'OTHER',
    ])).max(5),
    requireValidDrivingLicence: z.boolean(),
    requireSecurityDepositBeforeHandover: z.boolean(),
    allowOutstandingBalanceAtFinalization: z.boolean(),
    lateReturnRatePerHour: money.nullable(),
    lateReturnBillingIncrementMinutes: z.number().int().min(1).max(1440).nullable(),
    requiredInspectionComponents: z.array(z.object({
      code: z.string().trim().min(1).max(80),
      label: z.string().trim().min(1).max(120),
    })).max(60),
    accessories: z.array(z.object({
      code: z.string().trim().min(1).max(80),
      label: z.string().trim().min(1).max(120),
    })).max(60),
  }).superRefine((body, context) => {
    const requiredDocumentTypes = new Set(body.requiredCustomerDocumentTypes);
    if (requiredDocumentTypes.size !== body.requiredCustomerDocumentTypes.length) {
      context.addIssue({
        code: 'custom',
        path: ['requiredCustomerDocumentTypes'],
        message: 'Required customer document types must be unique.',
      });
    }
    for (const [field, entries] of [
      ['requiredInspectionComponents', body.requiredInspectionComponents],
      ['accessories', body.accessories],
    ]) {
      const codes = new Set(entries.map(({ code }) => code));
      if (codes.size !== entries.length) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Entry codes must be unique.',
        });
      }
    }
    if (body.lateReturnRatePerHour !== null && Number(body.lateReturnRatePerHour) <= 0) {
      context.addIssue({
        code: 'custom',
        path: ['lateReturnRatePerHour'],
        message: 'The configured late-return rate must be greater than zero.',
      });
    }
    if (
      (body.lateReturnRatePerHour === null) !==
      (body.lateReturnBillingIncrementMinutes === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lateReturnBillingIncrementMinutes'],
        message: 'Configure both the late-return rate and billing increment, or leave both unset.',
      });
    }
  }),
});

export const receiptParamsSchema = z.object({
  params: z.object({ bookingId: uuid, paymentId: uuid }),
});
export const finalizeSchema = z.object({
  params,
  body: z.object({
    notes: z.string().trim().max(2000).nullable().optional(),
  }),
});

export const customerDocumentsSchema = z.object({
  params: z.object({ customerId: uuid }),
});
export const customerDocumentParamsSchema = z.object({
  params: z.object({ customerId: uuid, documentId: uuid }),
});
