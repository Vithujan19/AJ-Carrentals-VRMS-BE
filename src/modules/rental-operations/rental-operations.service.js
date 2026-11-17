import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/errors.js';
import { writeAudit } from '../../shared/audit.js';
import {
  assertAssignedVehicle,
  bookingVehicleId,
  lockBooking,
  runBookingTransaction,
} from '../../shared/booking-transaction.js';
import { calculateRentalFinancialSummary } from '../../shared/rental-finance.js';
import { decimal } from '../bookings/booking-pricing.js';
import { inspectVehicleUpload } from '../vehicles/upload-validation.js';
import {
  allocationTotal,
  calculateExcessMileage,
  calculateLateReturnCharge,
} from './rental-operations-calculations.js';
import {
  handoverPayloadSchema,
  policyConfigurationSchema,
  returnPayloadSchema,
} from './rental-operations.schemas.js';

const OPERATIONS_POLICY_KEY = 'rental_operations_policy';
const defaultPolicy = Object.freeze({
  requiredCustomerDocumentTypes: [],
  requireValidDrivingLicence: false,
  requireSecurityDepositBeforeHandover: false,
  allowOutstandingBalanceAtFinalization: false,
  lateReturnRatePerHour: null,
  lateReturnBillingIncrementMinutes: null,
  requiredInspectionComponents: [],
  accessories: [],
});

const bookingFinancialInclude = {
  charges: { include: { approvals: true }, orderBy: { createdAt: 'asc' } },
  payments: {
    include: { allocations: true, receipts: { orderBy: { uploadedAt: 'asc' } } },
    orderBy: { transactionAt: 'asc' },
  },
  depositApplications: { orderBy: { appliedAt: 'asc' } },
};

function actorAuditFields(actor) {
  return {
    actorStaffUserId: actor?.id ?? null,
    actorIdentifierSnapshot: actor?.email ?? null,
  };
}

function mapDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function toPlainAmount(value) {
  return value?.toString?.() ?? '0.00';
}

function toJsonValue(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value, (_key, item) => (
    typeof item === 'bigint' ? item.toString() : item
  )));
}

function toOperationType(operation) {
  return operation === 'handover' ? 'HANDOVER' : 'RETURN';
}

function operationStatus(operation) {
  return operation === 'handover' ? 'CONFIRMED' : 'HANDED_OVER';
}

function assertOperationStatus(booking, operation) {
  const expectedStatus = operationStatus(operation);
  if (booking.status !== expectedStatus) {
    throw new AppError(
      409,
      'INVALID_RENTAL_OPERATION_STATUS',
      `${operation === 'handover' ? 'Handover' : 'Return'} can only be recorded for a booking in ${expectedStatus} status.`,
    );
  }
}

function assertNotFinalized(booking) {
  if (booking.status === 'COMPLETED') {
    throw new AppError(409, 'RENTAL_ALREADY_FINALIZED', 'A finalized rental cannot be changed.');
  }
}

async function assertCanAccessBooking(tx, booking, actor, permissions) {
  if (permissions?.includes('bookings.view') || permissions?.includes('rental.operations.view')) {
    return;
  }
  await assertAssignedVehicle(tx, booking.vehicleId, actor, permissions);
}

async function findBookingFinancials(tx, bookingId) {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: bookingFinancialInclude,
  });
  if (!booking) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking was not found.');
  }
  return {
    booking,
    summary: calculateRentalFinancialSummary(booking),
  };
}

function requirePositiveAmount(value, code = 'INVALID_AMOUNT') {
  const amount = decimal(value);
  if (!amount.greaterThan(0)) {
    throw new AppError(400, code, 'Amount must be greater than zero.');
  }
  return amount;
}

function parsePolicy(value) {
  const parsed = policyConfigurationSchema.shape.body.safeParse(value);
  if (!parsed.success) {
    throw new AppError(
      500,
      'INVALID_RENTAL_OPERATIONS_POLICY',
      'The configured rental-operations policy is invalid. Ask an administrator to review settings.',
    );
  }
  return parsed.data;
}

function colomboDayBounds(now) {
  const offsetMs = 5.5 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + offsetMs);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMs;
  return { start: new Date(start), end: new Date(start + 24 * 60 * 60 * 1000) };
}

function mapVerification(review) {
  if (!review) return null;
  return {
    id: review.id,
    status: review.status,
    checks: review.checks,
    notes: review.notes,
    rejectionReason: review.rejectionReason,
    reviewedAt: review.reviewedAt,
    reviewedBy: review.reviewedBy
      ? { id: review.reviewedBy.id, displayName: review.reviewedBy.displayName }
      : undefined,
  };
}

function mapCharge(charge) {
  return {
    id: charge.id,
    chargeType: charge.chargeType,
    direction: charge.direction,
    quantity: toPlainAmount(charge.quantity),
    unitPrice: toPlainAmount(charge.unitPrice),
    amount: toPlainAmount(charge.amount),
    currency: charge.currency,
    description: charge.description,
    approvalStatus: charge.approvalStatus,
    approvedAt: charge.approvedAt,
    recognizedAt: charge.recognizedAt,
    createdAt: charge.createdAt,
    voidedAt: charge.voidedAt,
    voidReason: charge.voidReason,
    approvals: (charge.approvals ?? []).map((approval) => ({
      id: approval.id,
      decision: approval.decision,
      reason: approval.reason,
      occurredAt: approval.occurredAt,
      actor: approval.actorStaffId,
    })),
  };
}

function mapPayment(payment) {
  return {
    id: payment.id,
    direction: payment.direction,
    purpose: payment.purpose,
    status: payment.status,
    method: payment.method,
    amount: toPlainAmount(payment.amount),
    currency: payment.currency,
    reference: payment.reference,
    notes: payment.notes,
    transactionAt: payment.transactionAt,
    recordedAt: payment.recordedAt,
    settledAt: payment.settledAt,
    originalPaymentId: payment.originalPaymentId,
    allocations: (payment.allocations ?? []).map((allocation) => ({
      id: allocation.id,
      allocationType: allocation.allocationType,
      amount: toPlainAmount(allocation.amount),
    })),
    receipts: (payment.receipts ?? []).map((receipt) => ({
      id: receipt.id,
      originalName: receipt.originalName,
      mimeType: receipt.mimeType,
      sizeBytes: receipt.sizeBytes.toString(),
      uploadedAt: receipt.uploadedAt,
    })),
  };
}

function mapPhoto(photo, bookingId) {
  return {
    id: photo.id,
    caption: photo.caption,
    mimeType: photo.mimeType,
    sizeBytes: photo.sizeBytes.toString(),
    sha256: photo.sha256 ?? undefined,
    capturedAt: photo.capturedAt ?? null,
    createdAt: photo.createdAt,
    contentUrl: `/api/v1/rental-operations/bookings/${bookingId}/photos/${photo.id}`,
  };
}

function mapDraft(draft, bookingId) {
  return {
    id: draft.id,
    operationType: draft.operationType,
    version: draft.version,
    payload: draft.payload,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    photos: (draft.photos ?? []).map((photo) => mapPhoto(photo, bookingId)),
  };
}

function mapInspection(inspection, bookingId) {
  if (!inspection) return null;
  return {
    id: inspection.id,
    stage: inspection.stage,
    inspectedAt: inspection.inspectedAt,
    conditionSummary: inspection.conditionSummary,
    customerAcknowledgedAt: inspection.customerAcknowledgedAt,
    acknowledgementMethod: inspection.acknowledgementMethod,
    items: inspection.items,
    photos: (inspection.photos ?? []).map((photo) => mapPhoto(photo, bookingId)),
    damages: (inspection.damages ?? []).map((damage) => ({
      id: damage.id,
      category: damage.category,
      severity: damage.severity,
      origin: damage.origin,
      status: damage.status,
      chargeApprovalStatus: damage.chargeApprovalStatus,
      description: damage.description,
      location: damage.location,
      estimatedRepairCost: damage.estimatedRepairCost?.toString() ?? null,
      approvedChargeAmount: damage.approvedChargeAmount?.toString() ?? null,
      createdAt: damage.createdAt,
      images: (damage.images ?? []).map((image) => ({
        id: image.id,
        caption: image.caption,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes.toString(),
        createdAt: image.createdAt,
        contentUrl: `/api/v1/rental-operations/damages/${damage.id}/images/${image.id}`,
      })),
    })),
  };
}

function mapRentalDetail(booking, permissions) {
  const canViewCustomerDocuments = permissions.includes('customers.documents.view');
  const canViewCustomerDetails = permissions.includes('customers.view') ||
    permissions.includes('customers.verify');
  const canViewCharges = permissions.includes('rental.charges.view') ||
    permissions.includes('bookings.pricing.view');
  const canViewPayments = permissions.includes('rental.payments.view') ||
    permissions.includes('payments.view');
  const canViewPricing = canViewCharges || canViewPayments ||
    permissions.includes('bookings.pricing.view');
  const canViewFinalization = canViewCharges || canViewPayments;
  const financialSummary = calculateRentalFinancialSummary(booking);
  const handover = booking.handover;
  const verification = booking.customerVerificationReviews?.[0] ?? null;

  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    source: booking.source,
    pickupAt: booking.pickupAt,
    returnAt: booking.returnAt,
    currency: booking.currency,
    confirmedTotal: canViewPricing
      ? toPlainAmount(booking.confirmedTotal ?? booking.estimatedTotal)
      : null,
    includedMileageKm: booking.includedMileageKmSnapshot,
    additionalKmRate: canViewPricing ? toPlainAmount(booking.additionalKmRateSnapshot) : null,
    securityDepositRequired: canViewPricing ? toPlainAmount(booking.securityDepositSnapshot) : null,
    customer: booking.customer ? {
      id: booking.customer.id,
      fullName: booking.customer.fullName,
      mobileNumber: booking.customer.mobileNumber,
      ...(canViewCustomerDetails ? {
        whatsappNumber: booking.customer.whatsappNumber,
        email: booking.customer.email,
        addressLine1: booking.customer.addressLine1,
        addressLine2: booking.customer.addressLine2,
        city: booking.customer.city,
        licenceExpiryDate: booking.customer.licenceExpiryDate,
        status: booking.customer.status,
      } : {}),
      documents: canViewCustomerDocuments
        ? booking.customer.documents.map((document) => ({
            id: document.id,
            documentType: document.documentType,
            originalName: document.originalName,
            mimeType: document.mimeType,
            sizeBytes: document.sizeBytes.toString(),
            expiresAt: document.expiresAt,
            uploadedAt: document.uploadedAt,
          }))
        : undefined,
    } : null,
    vehicle: booking.vehicle ? {
      id: booking.vehicle.id,
      registrationNumber: booking.vehicle.registrationNumber,
      currentOdometerKm: booking.vehicle.currentOdometerKm,
      specification: booking.vehicle.specification,
    } : null,
    verification: mapVerification(verification),
    handover: handover ? {
      id: handover.id,
      handedOverAt: handover.handedOverAt,
      startingOdometerKm: handover.startingOdometerKm,
      startingFuelPercent: toPlainAmount(handover.startingFuelPercent),
      notes: handover.notes,
      customerRepresentativeSnapshot: handover.customerRepresentativeSnapshot,
      accessories: handover.accessories,
      inspection: mapInspection(handover.inspections.find(({ stage }) => stage === 'HANDOVER'), booking.id),
    } : null,
    return: handover?.return ? {
      id: handover.return.id,
      returnedAt: handover.return.returnedAt,
      endingOdometerKm: handover.return.endingOdometerKm,
      distanceTravelledKm: handover.return.distanceTravelledKm,
      endingFuelPercent: toPlainAmount(handover.return.endingFuelPercent),
      fuelDifferencePercent: handover.return.fuelDifferencePercent?.toString() ?? null,
      returnLocationSnapshot: handover.return.returnLocationSnapshot,
      notes: handover.return.notes,
      accessories: handover.return.accessories,
      inspection: mapInspection(
        handover.return.inspections.find(({ stage }) => stage === 'RETURN'),
        booking.id,
      ),
    } : null,
    charges: canViewCharges ? booking.charges.map(mapCharge) : [],
    payments: canViewPayments ? booking.payments.map(mapPayment) : [],
    financialSummary: canViewCharges || canViewPayments ? financialSummary : null,
    finalization: canViewFinalization && booking.finalization ? {
      ...booking.finalization,
      rentalChargeTotal: toPlainAmount(booking.finalization.rentalChargeTotal),
      rentalPaymentsReceived: toPlainAmount(booking.finalization.rentalPaymentsReceived),
      rentalOutstanding: toPlainAmount(booking.finalization.rentalOutstanding),
      securityDepositCollected: toPlainAmount(booking.finalization.securityDepositCollected),
      securityDepositApplied: toPlainAmount(booking.finalization.securityDepositApplied),
      securityDepositRefunded: toPlainAmount(booking.finalization.securityDepositRefunded),
      remainingDeposit: toPlainAmount(booking.finalization.remainingDeposit),
    } : null,
  };
}

function makeUploadKey(upload, prefix) {
  const extension = upload.storageKey.slice(upload.storageKey.lastIndexOf('.') + 1);
  return `${prefix}/${randomUUID()}.${extension}`;
}

async function storeUploads(storage, uploads) {
  const storedKeys = [];
  try {
    for (const upload of uploads) {
      await storage.put(upload.storageKey, upload.buffer);
      storedKeys.push(upload.storageKey);
    }
    return storedKeys;
  } catch (error) {
    await Promise.all(storedKeys.map((key) => storage.delete(key)));
    throw error;
  }
}

async function cleanupStoredUploads(storage, keys, originalError) {
  try {
    await Promise.all(keys.map((key) => storage.delete(key)));
  } catch (cleanupError) {
    cleanupError.cause ??= originalError;
    throw cleanupError;
  }
}

  function baseAssignedWhere(actor, permissions, now) {
    if (permissions.includes('bookings.view') || permissions.includes('rental.operations.view')) {
      return {};
    }
    return {
      vehicle: {
        staffAssignments: {
          some: {
            staffUserId: actor.id,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      },
    };
  }

  function assertInspectionConfiguration(items, policy) {
    const componentCodes = new Set(items.map(({ componentCode }) => componentCode));
    if (componentCodes.size !== items.length) {
      throw new AppError(400, 'DUPLICATE_INSPECTION_COMPONENT', 'Each inspection component can be recorded only once.');
    }
    const missing = policy.requiredInspectionComponents
      .filter(({ code }) => !componentCodes.has(code));
    if (missing.length) {
      throw new AppError(
        409,
        'REQUIRED_INSPECTION_ITEMS_MISSING',
        `Complete the required inspection items: ${missing.map(({ label }) => label).join(', ')}.`,
      );
    }
  }

  function assertUniqueAccessories(accessories) {
    const codes = new Set(accessories.map(({ code }) => code));
    if (codes.size !== accessories.length) {
      throw new AppError(400, 'DUPLICATE_ACCESSORY', 'Each accessory can be recorded only once.');
    }
  }

  function assertRequiredAccessories(accessories, policy) {
    const accessoryCodes = new Set(accessories.map(({ code }) => code));
    const missing = policy.accessories.filter(({ code }) => !accessoryCodes.has(code));
    if (missing.length) {
      throw new AppError(
        409,
        'REQUIRED_ACCESSORIES_MISSING',
        `Record the required accessories: ${missing.map(({ label }) => label).join(', ')}.`,
      );
    }
  }

  async function createInspectionItems(tx, inspectionId, items) {
    await tx.rentalInspectionItem.createMany({
      data: items.map((item) => ({
        inspectionId,
        componentCode: item.componentCode,
        labelSnapshot: item.label,
        condition: item.condition,
        notes: item.notes ?? null,
      })),
    });
  }

  async function migrateDraftPhotos(tx, draft, inspectionId) {
    const photos = await tx.rentalOperationDraftPhoto.findMany({
      where: { draftId: draft.id },
      orderBy: { createdAt: 'asc' },
    });
    if (!photos.length) return [];
    await tx.rentalOperationDraftPhoto.deleteMany({ where: { draftId: draft.id } });
    await tx.inspectionPhoto.createMany({
      data: photos.map((photo) => ({
        id: photo.id,
        inspectionId,
        uploadedByStaffId: photo.uploadedByStaffId,
        storageKey: photo.storageKey,
        caption: photo.caption,
        mimeType: photo.mimeType,
        sizeBytes: photo.sizeBytes,
        sha256: photo.sha256,
        capturedAt: photo.capturedAt,
        createdAt: photo.createdAt,
      })),
    });
    return photos.map(({ id }) => id);
  }

  async function createDamageReports(tx, {
    inspectionId,
    damages,
    actor,
  }) {
    const created = [];
    for (const damage of damages) {
      const isPreExisting = damage.origin === 'PRE_EXISTING';
      const report = await tx.damageReport.create({
        data: {
          inspectionId,
          category: damage.category,
          severity: damage.severity,
          origin: damage.origin,
          status: 'ASSESSED',
          chargeApprovalStatus: isPreExisting ? 'REJECTED' : 'PENDING',
          description: damage.description,
          location: damage.location ?? null,
          estimatedRepairCost: damage.estimatedRepairCost
            ? decimal(damage.estimatedRepairCost)
            : null,
          ...(isPreExisting
            ? { approvals: { create: {
                actorStaffId: actor.id,
                decision: 'REJECTED',
                reason: 'Recorded as pre-existing; no customer charge was approved.',
              } } }
            : {}),
        },
      });
      created.push(report);
    }
    return created;
  }

  function validateDraftPayload(schema, payload) {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new AppError(
        400,
        'INCOMPLETE_RENTAL_OPERATION_DRAFT',
        'Complete all required operational details before finalizing this step.',
      );
    }
    return result.data;
  }

  async function createPendingOperationCharge(tx, {
    bookingId,
    actor,
    chargeType,
    quantity,
    unitPrice,
    amount,
    currency,
    idempotencyKey,
    description,
    reason,
  }) {
    const existing = await tx.bookingCharge.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;
    const charge = await tx.bookingCharge.create({
      data: {
        bookingId,
        createdByStaffId: actor.id,
        idempotencyKey,
        chargeType,
        direction: 'DEBIT',
        quantity: decimal(quantity),
        unitPrice: decimal(unitPrice),
        amount: decimal(amount),
        currency,
        description,
        approvalStatus: 'PENDING',
      },
    });
    await tx.bookingChargeApproval.create({
      data: {
        bookingChargeId: charge.id,
        actorStaffId: actor.id,
        decision: 'PENDING',
        reason,
      },
    });
    return charge;
  }

function rentalDetailInclude() {
  return {
    customer: {
      select: {
        id: true,
        fullName: true,
        mobileNumber: true,
        whatsappNumber: true,
        email: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        licenceExpiryDate: true,
        status: true,
        documents: {
          where: { archivedAt: null },
          orderBy: [{ documentType: 'asc' }, { uploadedAt: 'desc' }],
          select: {
            id: true,
            documentType: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            expiresAt: true,
            uploadedAt: true,
          },
        },
      },
    },
    vehicle: {
      select: {
        id: true,
        registrationNumber: true,
        currentOdometerKm: true,
        specification: true,
      },
    },
    customerVerificationReviews: {
      orderBy: { reviewedAt: 'desc' },
      take: 1,
      include: { reviewedBy: { select: { id: true, displayName: true } } },
    },
    handover: {
      include: {
        accessories: { orderBy: { createdAt: 'asc' } },
        inspections: {
          include: {
            items: { orderBy: { componentCode: 'asc' } },
            photos: { orderBy: { createdAt: 'asc' } },
            damages: {
              orderBy: { createdAt: 'asc' },
              include: { images: { orderBy: { createdAt: 'asc' } }, approvals: true },
            },
          },
        },
        return: {
          include: {
            accessories: {
              include: { handoverAccessory: true },
              orderBy: { handoverAccessoryId: 'asc' },
            },
            inspections: {
              include: {
                items: { orderBy: { componentCode: 'asc' } },
                photos: { orderBy: { createdAt: 'asc' } },
                damages: {
                  orderBy: { createdAt: 'asc' },
                  include: { images: { orderBy: { createdAt: 'asc' } }, approvals: true },
                },
              },
            },
          },
        },
      },
    },
    ...bookingFinancialInclude,
    finalization: true,
  };
}

function mapRentalListItem(booking, now) {
  const returnAt = booking.returnAt;
  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    pickupAt: booking.pickupAt,
    returnAt,
    isOverdue: booking.status === 'HANDED_OVER' && returnAt < now,
    customer: {
      fullName: booking.customerNameSnapshot,
      mobileNumber: booking.customerMobileSnapshot,
    },
    vehicle: {
      registrationNumber: booking.registrationSnapshot,
      make: booking.vehicle?.specification?.make ?? null,
      model: booking.vehicle?.specification?.model ?? null,
    },
    handover: booking.handover ? {
      handedOverAt: booking.handover.handedOverAt,
      startingOdometerKm: booking.handover.startingOdometerKm,
    } : null,
    return: booking.handover?.return ? {
      returnedAt: booking.handover.return.returnedAt,
      endingOdometerKm: booking.handover.return.endingOdometerKm,
    } : null,
  };
}

export function createRentalOperationsService({ prisma, storage }) {
  async function getPolicy(tx = prisma) {
    const setting = await tx.systemSetting.findUnique({
      where: { key: OPERATIONS_POLICY_KEY },
      select: { value: true },
    });
    return setting ? parsePolicy(setting.value) : defaultPolicy;
  }

  async function loadRentalDetail(bookingId, actor, permissions) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: rentalDetailInclude(),
    });
    if (!booking) {
      throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking was not found.');
    }
    await assertCanAccessBooking(prisma, booking, actor, permissions);
    return mapRentalDetail(booking, permissions);
  }

  async function getOperationDraft({ bookingId, operation, actor, permissions }) {
    const record = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, vehicleId: true },
    });
    if (!record) {
      throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking was not found.');
    }
    await assertCanAccessBooking(prisma, record, actor, permissions);
    const draft = await prisma.rentalOperationDraft.findUnique({
      where: {
        bookingId_operationType: {
          bookingId,
          operationType: toOperationType(operation),
        },
      },
      include: { photos: { orderBy: { createdAt: 'asc' } } },
    });
    return draft ? mapDraft(draft, bookingId) : null;
  }

  return {
    async policy() {
      return getPolicy();
    },

    async verifyCustomer({ bookingId, input, actor, permissions, auditContext }) {
      const vehicleId = await bookingVehicleId(prisma, bookingId);
      return runBookingTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, bookingId, vehicleId);
        await assertCanAccessBooking(tx, booking, actor, permissions);
        if (booking.status !== 'CONFIRMED') {
          throw new AppError(409, 'CUSTOMER_VERIFICATION_NOT_ALLOWED', 'Customer verification must be completed before vehicle handover.');
        }

        const existing = await tx.rentalCustomerVerification.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { reviewedBy: { select: { id: true, displayName: true } } },
        });
        if (existing) {
          if (existing.bookingId !== bookingId) {
            throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used.');
          }
          return mapVerification(existing);
        }

        const [customer, policy] = await Promise.all([
          tx.customer.findUnique({
            where: { id: booking.customerId },
            select: {
              id: true,
              licenceExpiryDate: true,
              documents: {
                where: { archivedAt: null },
                select: { id: true, documentType: true, expiresAt: true },
              },
            },
          }),
          getPolicy(tx),
        ]);
        if (!customer) {
          throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'The booking customer was not found.');
        }
        const reviewedIds = new Set(input.checks.documentsReviewed);
        const customerDocuments = new Map(customer.documents.map((document) => [document.id, document]));
        if ([...reviewedIds].some((id) => !customerDocuments.has(id))) {
          throw new AppError(400, 'INVALID_CUSTOMER_DOCUMENT', 'Only active documents belonging to this customer can be reviewed.');
        }

        const reviewDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Colombo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date());
        if (input.status === 'VERIFIED') {
          const missingTypes = policy.requiredCustomerDocumentTypes.filter((type) => (
            !customer.documents.some((document) => (
              document.documentType === type &&
              reviewedIds.has(document.id) &&
              (!document.expiresAt || document.expiresAt.toISOString().slice(0, 10) >= reviewDate)
            ))
          ));
          if (missingTypes.length) {
            throw new AppError(
              409,
              'REQUIRED_CUSTOMER_DOCUMENTS_MISSING',
              `Review valid customer documents for: ${missingTypes.join(', ')}.`,
            );
          }
          if (policy.requireValidDrivingLicence) {
            if (
              !input.checks.licenceVerified ||
              !customer.licenceExpiryDate ||
              customer.licenceExpiryDate.toISOString().slice(0, 10) < reviewDate
            ) {
              throw new AppError(
                409,
                'VALID_DRIVING_LICENCE_REQUIRED',
                'A valid driving licence must be verified before handover.',
              );
            }
          }
        }

        const review = await tx.rentalCustomerVerification.create({
          data: {
            bookingId,
            customerId: booking.customerId,
            reviewedByStaffId: actor.id,
            idempotencyKey: input.idempotencyKey,
            status: input.status,
            checks: input.checks,
            notes: input.notes ?? null,
            rejectionReason: input.rejectionReason ?? null,
          },
          include: { reviewedBy: { select: { id: true, displayName: true } } },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'rental.customer_verification_recorded',
          entityType: 'Booking',
          entityId: bookingId,
          ...auditContext,
          afterSnapshot: {
            verificationId: review.id,
            status: review.status,
            reviewedDocumentIds: input.checks.documentsReviewed,
          },
        });
        return mapVerification(review);
      });
    },

    async updatePolicy({ input, actor, auditContext }) {
      const policy = parsePolicy(input);
      return prisma.$transaction(async (tx) => {
        const previous = await tx.systemSetting.findUnique({
          where: { key: OPERATIONS_POLICY_KEY },
          select: { value: true },
        });
        await tx.systemSetting.upsert({
          where: { key: OPERATIONS_POLICY_KEY },
          update: {
            value: policy,
            description: 'Configured requirements and rates for rental operations.',
            updatedByStaffId: actor.id,
          },
          create: {
            key: OPERATIONS_POLICY_KEY,
            value: policy,
            description: 'Configured requirements and rates for rental operations.',
            updatedByStaffId: actor.id,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'rental_operations.policy_updated',
          entityType: 'SystemSetting',
          entityId: OPERATIONS_POLICY_KEY,
          ...auditContext,
          beforeSnapshot: previous?.value ?? null,
          afterSnapshot: policy,
        });
        return policy;
      });
    },

    async dashboard({ query, actor, permissions }) {
      const now = new Date();
      const { start, end } = colomboDayBounds(now);
      const where = {
        status: query.bucket === 'UPCOMING' ? 'CONFIRMED' : 'HANDED_OVER',
        ...(query.bucket === 'DUE_TODAY'
          ? { returnAt: { gte: start, lt: end } }
          : query.bucket === 'OVERDUE'
            ? { returnAt: { lt: now } }
            : query.bucket === 'ACTIVE'
              ? {}
              : { pickupAt: { gte: now } }),
        ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
        ...(query.search
          ? {
              OR: [
                { reference: { contains: query.search } },
                { customerNameSnapshot: { contains: query.search } },
                { customerMobileSnapshot: { contains: query.search } },
                { registrationSnapshot: { contains: query.search } },
              ],
            }
          : {}),
      };
      if (!permissions.includes('bookings.view') && !permissions.includes('rental.operations.view')) {
        where.vehicle = {
          staffAssignments: {
            some: {
              staffUserId: actor.id,
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
          },
        };
      }

      const [items, total, activeCount, dueTodayCount, overdueCount, upcomingCount] =
        await prisma.$transaction([
          prisma.booking.findMany({
            where,
            include: {
              vehicle: { select: { specification: { select: { make: true, model: true } } } },
              handover: { include: { return: true } },
            },
            orderBy: [{ returnAt: 'asc' }, { pickupAt: 'asc' }],
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
          prisma.booking.count({ where }),
          prisma.booking.count({ where: { ...baseAssignedWhere(actor, permissions, now), status: 'HANDED_OVER' } }),
          prisma.booking.count({
            where: {
              ...baseAssignedWhere(actor, permissions, now),
              status: 'HANDED_OVER',
              returnAt: { gte: start, lt: end },
            },
          }),
          prisma.booking.count({
            where: {
              ...baseAssignedWhere(actor, permissions, now),
              status: 'HANDED_OVER',
              returnAt: { lt: now },
            },
          }),
          prisma.booking.count({
            where: {
              ...baseAssignedWhere(actor, permissions, now),
              status: 'CONFIRMED',
              pickupAt: { gte: now },
            },
          }),
        ]);
      return {
        items: items.map((booking) => mapRentalListItem(booking, now)),
        page: query.page,
        limit: query.limit,
        total,
        counts: {
          active: activeCount,
          dueToday: dueTodayCount,
          overdue: overdueCount,
          upcoming: upcomingCount,
        },
      };
    },

    async getDetail({ bookingId, actor, permissions }) {
      return loadRentalDetail(bookingId, actor, permissions);
    },

    async operationDraft({ bookingId, operation, actor, permissions }) {
      return getOperationDraft({ bookingId, operation, actor, permissions });
    },

    async startOperationDraft({ bookingId, operation, actor, permissions, auditContext }) {
      const vehicleId = await bookingVehicleId(prisma, bookingId);
      return runBookingTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, bookingId, vehicleId);
        await assertCanAccessBooking(tx, booking, actor, permissions);
        assertOperationStatus(booking, operation);
        const operationType = toOperationType(operation);
        const existing = await tx.rentalOperationDraft.findUnique({
          where: { bookingId_operationType: { bookingId, operationType } },
          include: { photos: { orderBy: { createdAt: 'asc' } } },
        });
        if (existing) return mapDraft(existing, bookingId);
        const draft = await tx.rentalOperationDraft.create({
          data: {
            bookingId,
            operationType,
            payload: {},
            createdByStaffId: actor.id,
            updatedByStaffId: actor.id,
          },
          include: { photos: true },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: `rental.${operation}.draft_created`,
          entityType: 'Booking',
          entityId: bookingId,
          ...auditContext,
          afterSnapshot: { draftId: draft.id, operationType },
        });
        return mapDraft(draft, bookingId);
      });
    },

    async updateOperationDraft({
      bookingId,
      operation,
      version,
      payload,
      actor,
      permissions,
      auditContext,
    }) {
      if (!version) {
        throw new AppError(400, 'DRAFT_VERSION_REQUIRED', 'Reload the draft and submit its current version.');
      }
      const vehicleId = await bookingVehicleId(prisma, bookingId);
      return runBookingTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, bookingId, vehicleId);
        await assertCanAccessBooking(tx, booking, actor, permissions);
        assertOperationStatus(booking, operation);
        const operationType = toOperationType(operation);
        const current = await tx.rentalOperationDraft.findUnique({
          where: { bookingId_operationType: { bookingId, operationType } },
        });
        if (!current) {
          throw new AppError(404, 'RENTAL_OPERATION_DRAFT_NOT_FOUND', 'Start the operation before editing its draft.');
        }
        if (current.version !== version) {
          throw new AppError(409, 'DRAFT_VERSION_CONFLICT', 'This draft changed in another session. Reload it before saving.');
        }
        const mergedPayload = { ...current.payload, ...payload };
        const changed = await tx.rentalOperationDraft.updateMany({
          where: { id: current.id, version },
          data: {
            payload: mergedPayload,
            version: { increment: 1 },
            updatedByStaffId: actor.id,
          },
        });
        if (changed.count !== 1) {
          throw new AppError(409, 'DRAFT_VERSION_CONFLICT', 'This draft changed in another session. Reload it before saving.');
        }
        const updated = await tx.rentalOperationDraft.findUnique({
          where: { id: current.id },
          include: { photos: { orderBy: { createdAt: 'asc' } } },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: `rental.${operation}.draft_updated`,
          entityType: 'Booking',
          entityId: bookingId,
          ...auditContext,
          beforeSnapshot: { draftId: current.id, version, fields: Object.keys(payload) },
          afterSnapshot: { draftId: current.id, version: updated.version },
        });
        return mapDraft(updated, bookingId);
      });
    },

    async operationDraftPhotos({ bookingId, operation, actor, permissions }) {
      const draft = await prisma.rentalOperationDraft.findUnique({
        where: {
          bookingId_operationType: {
            bookingId,
            operationType: toOperationType(operation),
          },
        },
        include: { photos: { orderBy: { createdAt: 'asc' } } },
      });
      if (!draft) {
        throw new AppError(404, 'RENTAL_OPERATION_DRAFT_NOT_FOUND', 'Start the operation before uploading photographs.');
      }
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, vehicleId: true },
      });
      if (!booking) {
        throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking was not found.');
      }
      await assertCanAccessBooking(prisma, booking, actor, permissions);
      return draft.photos.map((photo) => mapPhoto(photo, bookingId));
    },

    async completeHandover({
      bookingId,
      version,
      actor,
      permissions,
      auditContext,
    }) {
      const vehicleId = await bookingVehicleId(prisma, bookingId);
      await runBookingTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, bookingId, vehicleId);
        await assertCanAccessBooking(tx, booking, actor, permissions);
        if (booking.status === 'HANDED_OVER' && await tx.rentalHandover.findUnique({ where: { bookingId } })) {
          return;
        }
        assertOperationStatus(booking, 'handover');
        const draft = await tx.rentalOperationDraft.findUnique({
          where: {
            bookingId_operationType: {
              bookingId,
              operationType: 'HANDOVER',
            },
          },
        });
        if (!draft) {
          throw new AppError(409, 'HANDOVER_DRAFT_REQUIRED', 'Start and complete the handover draft first.');
        }
        if (draft.version !== version) {
          throw new AppError(409, 'DRAFT_VERSION_CONFLICT', 'This draft changed in another session. Reload it before completing handover.');
        }
        const payload = validateDraftPayload(handoverPayloadSchema, draft.payload);
        const policy = await getPolicy(tx);
        assertInspectionConfiguration(payload.inspectionItems, policy);
        assertUniqueAccessories(payload.accessories);
        assertRequiredAccessories(payload.accessories, policy);

        const now = new Date();
        const handedOverAt = mapDate(payload.actualAt);
        if (handedOverAt > now) {
          throw new AppError(400, 'HANDOVER_CANNOT_BE_FUTURE', 'Handover time cannot be in the future.');
        }
        const latestVerification = await tx.rentalCustomerVerification.findFirst({
          where: { bookingId },
          orderBy: { reviewedAt: 'desc' },
        });
        if (latestVerification?.status !== 'VERIFIED') {
          throw new AppError(409, 'CUSTOMER_VERIFICATION_REQUIRED', 'Verify the booking customer before handing over the vehicle.');
        }
        const customer = await tx.customer.findUnique({
          where: { id: booking.customerId },
          select: {
            licenceExpiryDate: true,
            documents: {
              where: { archivedAt: null },
              select: { id: true, documentType: true, expiresAt: true },
            },
          },
        });
        if (!customer) {
          throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'The booking customer was not found.');
        }
        const review = latestVerification.checks;
        const reviewedDocumentIds = new Set(review.documentsReviewed ?? []);
        const reviewDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Colombo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(now);
        const missingTypes = policy.requiredCustomerDocumentTypes.filter((type) => (
          !customer.documents.some((document) => (
            document.documentType === type &&
            reviewedDocumentIds.has(document.id) &&
            (!document.expiresAt || document.expiresAt.toISOString().slice(0, 10) >= reviewDate)
          ))
        ));
        if (missingTypes.length) {
          throw new AppError(
            409,
            'REQUIRED_CUSTOMER_DOCUMENTS_MISSING',
            `Required customer documents are missing or expired: ${missingTypes.join(', ')}.`,
          );
        }
        if (policy.requireValidDrivingLicence && (
          !review.licenceVerified ||
          !customer.licenceExpiryDate ||
          customer.licenceExpiryDate.toISOString().slice(0, 10) < reviewDate
        )) {
          throw new AppError(409, 'VALID_DRIVING_LICENCE_REQUIRED', 'A valid driving licence must be verified before handover.');
        }

        const vehicle = await tx.vehicle.findUnique({
          where: { id: booking.vehicleId },
          select: { currentOdometerKm: true },
        });
        if (
          vehicle.currentOdometerKm !== null &&
          payload.odometerKm < vehicle.currentOdometerKm
        ) {
          throw new AppError(409, 'MILEAGE_CANNOT_DECREASE', 'Handover mileage cannot be below the current odometer.');
        }

        const financial = await findBookingFinancials(tx, bookingId);
        const rentalPolicy = booking.rentalPolicyId
          ? await tx.rentalPolicy.findUnique({
              where: { id: booking.rentalPolicyId },
              select: { advancePaymentPercent: true },
            })
          : null;
        if (rentalPolicy?.advancePaymentPercent) {
          const requiredAdvance = decimal(booking.confirmedTotal ?? booking.estimatedTotal)
            .mul(rentalPolicy.advancePaymentPercent)
            .div(100);
          if (decimal(financial.summary.rentalReceived).lessThan(requiredAdvance)) {
            throw new AppError(
              409,
              'ADVANCE_PAYMENT_REQUIRED',
              `Record the required rental advance of ${requiredAdvance.toFixed(2)} ${booking.currency} before handover.`,
            );
          }
        }
        if (
          policy.requireSecurityDepositBeforeHandover &&
          decimal(financial.summary.securityDepositCollected)
            .lessThan(decimal(booking.securityDepositSnapshot))
        ) {
          throw new AppError(409, 'SECURITY_DEPOSIT_REQUIRED', 'Collect the configured security deposit before handover.');
        }

        const handover = await tx.rentalHandover.create({
          data: {
            bookingId,
            staffUserId: actor.id,
            customerRepresentativeSnapshot: payload.customerRepresentative ?? null,
            notes: payload.notes ?? null,
            handedOverAt,
            startingOdometerKm: payload.odometerKm,
            startingFuelPercent: decimal(payload.fuelPercent),
            accessories: {
              create: payload.accessories.map((accessory) => ({
                accessoryNameSnapshot: accessory.label,
                wasSupplied: accessory.supplied,
                quantityIssued: accessory.quantity,
                condition: accessory.condition,
                notes: accessory.notes ?? null,
              })),
            },
          },
        });
        const inspection = await tx.rentalInspection.create({
          data: {
            handoverId: handover.id,
            inspectedByStaffId: actor.id,
            stage: 'HANDOVER',
            inspectedAt: handedOverAt,
            conditionSummary: payload.notes ?? null,
            customerAcknowledgedAt: now,
            acknowledgementMethod: 'IN_PERSON',
          },
        });
        await createInspectionItems(tx, inspection.id, payload.inspectionItems);
        await createDamageReports(tx, {
          inspectionId: inspection.id,
          damages: payload.damages,
          actor,
        });
        const photoIds = await migrateDraftPhotos(tx, draft, inspection.id);
        await tx.vehicle.update({
          where: { id: booking.vehicleId },
          data: { currentOdometerKm: payload.odometerKm },
        });
        await tx.vehicleMileageReading.create({
          data: {
            vehicleId: booking.vehicleId,
            recordedByStaffId: actor.id,
            readingKm: payload.odometerKm,
            previousOdometerKm: vehicle.currentOdometerKm,
            source: 'MANUAL',
            reason: `Rental handover ${booking.reference}`,
            recordedAt: handedOverAt,
          },
        });
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'HANDED_OVER' },
        });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId,
            changedByStaffId: actor.id,
            fromStatus: 'CONFIRMED',
            toStatus: 'HANDED_OVER',
            occurredAt: handedOverAt,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'rental.handover_completed',
          entityType: 'Booking',
          entityId: bookingId,
          ...auditContext,
          beforeSnapshot: { status: 'CONFIRMED', odometerKm: vehicle.currentOdometerKm },
          afterSnapshot: {
            status: 'HANDED_OVER',
            handoverId: handover.id,
            inspectionId: inspection.id,
            startingOdometerKm: payload.odometerKm,
            startingFuelPercent: payload.fuelPercent,
            photoIds,
          },
        });
      });
      return loadRentalDetail(bookingId, actor, permissions);
    },

    async completeReturn({
      bookingId,
      version,
      actor,
      permissions,
      auditContext,
    }) {
      const vehicleId = await bookingVehicleId(prisma, bookingId);
      await runBookingTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, bookingId, vehicleId);
        await assertCanAccessBooking(tx, booking, actor, permissions);
        if (booking.status === 'RETURNED' && await tx.rentalReturn.findFirst({
          where: { handover: { bookingId } },
        })) {
          return;
        }
        assertOperationStatus(booking, 'return');
        const draft = await tx.rentalOperationDraft.findUnique({
          where: {
            bookingId_operationType: {
              bookingId,
              operationType: 'RETURN',
            },
          },
        });
        if (!draft) {
          throw new AppError(409, 'RETURN_DRAFT_REQUIRED', 'Start and complete the return draft first.');
        }
        if (draft.version !== version) {
          throw new AppError(409, 'DRAFT_VERSION_CONFLICT', 'This draft changed in another session. Reload it before completing the return.');
        }
        const payload = validateDraftPayload(returnPayloadSchema, draft.payload);
        const policy = await getPolicy(tx);
        assertInspectionConfiguration(payload.inspectionItems, policy);
        const returnedAt = mapDate(payload.actualAt);
        const now = new Date();
        if (returnedAt > now) {
          throw new AppError(400, 'RETURN_CANNOT_BE_FUTURE', 'Return time cannot be in the future.');
        }

        const handover = await tx.rentalHandover.findUnique({
          where: { bookingId },
          include: { accessories: { orderBy: { createdAt: 'asc' } } },
        });
        if (!handover) {
          throw new AppError(409, 'HANDOVER_REQUIRED', 'Complete vehicle handover before recording a return.');
        }
        if (returnedAt < handover.handedOverAt) {
          throw new AppError(400, 'INVALID_RETURN_TIME', 'Return time must follow the handover time.');
        }
        if (payload.odometerKm < handover.startingOdometerKm) {
          throw new AppError(409, 'MILEAGE_CANNOT_DECREASE', 'Return mileage cannot be below handover mileage.');
        }
        const issuedAccessories = new Map(handover.accessories.map((item) => [item.id, item]));
        if (payload.returnAccessories.length !== issuedAccessories.size) {
          throw new AppError(409, 'RETURN_ACCESSORY_RECONCILIATION_REQUIRED', 'Record the return status of every handover accessory.');
        }
        for (const item of payload.returnAccessories) {
          const issued = issuedAccessories.get(item.handoverAccessoryId);
          if (!issued || item.quantityReturned > issued.quantityIssued) {
            throw new AppError(400, 'INVALID_RETURN_ACCESSORY', 'A returned accessory does not match the recorded handover.');
          }
        }

        const vehicle = await tx.vehicle.findUnique({
          where: { id: booking.vehicleId },
          select: { currentOdometerKm: true },
        });
        if (
          vehicle.currentOdometerKm !== null &&
          payload.odometerKm < vehicle.currentOdometerKm
        ) {
          throw new AppError(409, 'MILEAGE_CANNOT_DECREASE', 'Return mileage cannot be below the current odometer.');
        }
        const distanceTravelledKm = payload.odometerKm - handover.startingOdometerKm;
        const excessMileageKm = calculateExcessMileage(
          distanceTravelledKm,
          booking.includedMileageKmSnapshot,
        );
        const rentalReturn = await tx.rentalReturn.create({
          data: {
            handoverId: handover.id,
            staffUserId: actor.id,
            returnLocationSnapshot: payload.returnLocation ?? null,
            notes: payload.notes ?? null,
            returnedAt,
            endingOdometerKm: payload.odometerKm,
            distanceTravelledKm,
            endingFuelPercent: decimal(payload.fuelPercent),
            fuelDifferencePercent: decimal(payload.fuelPercent).minus(handover.startingFuelPercent),
            accessories: {
              create: payload.returnAccessories.map((item) => ({
                handoverAccessoryId: item.handoverAccessoryId,
                quantityReturned: item.quantityReturned,
                notes: item.notes ?? null,
              })),
            },
          },
        });
        const inspection = await tx.rentalInspection.create({
          data: {
            rentalReturnId: rentalReturn.id,
            inspectedByStaffId: actor.id,
            stage: 'RETURN',
            inspectedAt: returnedAt,
            conditionSummary: payload.notes ?? null,
            customerAcknowledgedAt: now,
            acknowledgementMethod: 'IN_PERSON',
          },
        });
        await createInspectionItems(tx, inspection.id, payload.inspectionItems);
        const reports = await createDamageReports(tx, {
          inspectionId: inspection.id,
          damages: payload.damages,
          actor,
        });
        const photoIds = await migrateDraftPhotos(tx, draft, inspection.id);

        const createdCharges = [];
        if (excessMileageKm > 0 && decimal(booking.additionalKmRateSnapshot).greaterThan(0)) {
          const amount = decimal(excessMileageKm)
            .mul(booking.additionalKmRateSnapshot)
            .toDecimalPlaces(2);
          if (amount.greaterThan(0)) {
            createdCharges.push(await createPendingOperationCharge(tx, {
              bookingId,
              actor,
              chargeType: 'EXTRA_KILOMETRE',
              quantity: decimal(excessMileageKm),
              unitPrice: decimal(booking.additionalKmRateSnapshot),
              amount,
              currency: booking.currency,
              idempotencyKey: `rental-operations:${bookingId}:excess-km`,
              description: `${excessMileageKm} km above the included allowance.`,
              reason: `Included allowance: ${booking.includedMileageKmSnapshot} km; distance travelled: ${distanceTravelledKm} km.`,
            }));
          }
        }

        const rentalPolicy = booking.rentalPolicyId
          ? await tx.rentalPolicy.findUnique({
              where: { id: booking.rentalPolicyId },
              select: { lateReturnGraceMinutes: true },
            })
          : null;
        const lateCharge = calculateLateReturnCharge({
          scheduledReturnAt: booking.returnAt,
          actualReturnAt: returnedAt,
          graceMinutes: rentalPolicy?.lateReturnGraceMinutes ?? 0,
          ratePerHour: policy.lateReturnRatePerHour,
          billingIncrementMinutes: policy.lateReturnBillingIncrementMinutes,
        });
        if (lateCharge) {
          createdCharges.push(await createPendingOperationCharge(tx, {
            bookingId,
            actor,
            chargeType: 'LATE_RETURN',
            quantity: decimal(lateCharge.units),
            unitPrice: decimal(lateCharge.unitPrice),
            amount: decimal(lateCharge.amount),
            currency: booking.currency,
            idempotencyKey: `rental-operations:${bookingId}:late-return`,
            description: `${lateCharge.chargeableMinutes} late minutes billed in ${policy.lateReturnBillingIncrementMinutes}-minute increments.`,
            reason: `Scheduled return: ${booking.returnAt.toISOString()}; actual return: ${returnedAt.toISOString()}.`,
          }));
        }

        if (payload.maintenanceRequired) {
          const block = await tx.vehicleAvailabilityBlock.create({
            data: {
              vehicleId: booking.vehicleId,
              createdByStaffId: actor.id,
              reason: 'MAINTENANCE',
              status: 'ACTIVE',
              startsAt: returnedAt,
              description: payload.maintenanceReason,
            },
          });
          await writeAudit(tx, {
            ...actorAuditFields(actor),
            action: 'vehicle.maintenance_block_created_from_return',
            entityType: 'VehicleAvailabilityBlock',
            entityId: block.id,
            ...auditContext,
            afterSnapshot: {
              vehicleId: booking.vehicleId,
              reason: block.reason,
              startsAt: block.startsAt,
              description: block.description,
            },
          });
        }
        await tx.vehicle.update({
          where: { id: booking.vehicleId },
          data: { currentOdometerKm: payload.odometerKm },
        });
        await tx.vehicleMileageReading.create({
          data: {
            vehicleId: booking.vehicleId,
            recordedByStaffId: actor.id,
            readingKm: payload.odometerKm,
            previousOdometerKm: vehicle.currentOdometerKm,
            source: 'MANUAL',
            reason: `Rental return ${booking.reference}`,
            recordedAt: returnedAt,
          },
        });
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'RETURNED' },
        });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId,
            changedByStaffId: actor.id,
            fromStatus: 'HANDED_OVER',
            toStatus: 'RETURNED',
            reason: 'Vehicle returned and inspection recorded.',
            occurredAt: returnedAt,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'rental.return_completed',
          entityType: 'Booking',
          entityId: bookingId,
          ...auditContext,
          beforeSnapshot: { status: 'HANDED_OVER', odometerKm: vehicle.currentOdometerKm },
          afterSnapshot: {
            status: 'RETURNED',
            returnId: rentalReturn.id,
            inspectionId: inspection.id,
            returnedAt,
            endingOdometerKm: payload.odometerKm,
            distanceTravelledKm,
            excessMileageKm,
            damageReportIds: reports.map(({ id }) => id),
            chargeIds: createdCharges.map(({ id }) => id),
            photoIds,
          },
        });
      });
      return loadRentalDetail(bookingId, actor, permissions);
    },

    async createCharge({ bookingId, input, actor, permissions, auditContext }) {
      const vehicleId = await bookingVehicleId(prisma, bookingId);
      return runBookingTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, bookingId, vehicleId);
        await assertCanAccessBooking(tx, booking, actor, permissions);
        assertNotFinalized(booking);
        if (!['HANDED_OVER', 'RETURNED'].includes(booking.status)) {
          throw new AppError(409, 'CHARGE_NOT_ALLOWED', 'Additional rental charges can be recorded after handover.');
        }
        const replay = await tx.bookingCharge.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (replay) {
          if (replay.bookingId !== bookingId) {
            throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used.');
          }
          return mapCharge({
            ...replay,
            approvals: await tx.bookingChargeApproval.findMany({
              where: { bookingChargeId: replay.id },
              orderBy: { occurredAt: 'asc' },
            }),
          });
        }
        const quantity = requirePositiveAmount(input.quantity);
        const unitPrice = requirePositiveAmount(input.unitPrice);
        const amount = quantity.mul(unitPrice).toDecimalPlaces(2);
        if (!amount.greaterThan(0)) {
          throw new AppError(400, 'INVALID_AMOUNT', 'The calculated charge must be greater than zero.');
        }
        const charge = await tx.bookingCharge.create({
          data: {
            bookingId,
            createdByStaffId: actor.id,
            idempotencyKey: input.idempotencyKey,
            chargeType: input.chargeType,
            direction: input.direction,
            quantity,
            unitPrice,
            amount,
            currency: booking.currency,
            description: input.description,
            approvalStatus: 'PENDING',
          },
        });
        const approval = await tx.bookingChargeApproval.create({
          data: {
            bookingChargeId: charge.id,
            actorStaffId: actor.id,
            decision: 'PENDING',
            reason: input.reason,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'rental.charge_proposed',
          entityType: 'BookingCharge',
          entityId: charge.id,
          ...auditContext,
          afterSnapshot: {
            bookingId,
            chargeType: charge.chargeType,
            direction: charge.direction,
            quantity: quantity.toString(),
            unitPrice: unitPrice.toString(),
            amount: amount.toString(),
            approvalStatus: charge.approvalStatus,
            approvalId: approval.id,
          },
        });
        return mapCharge({ ...charge, approvals: [approval] });
      });
    },

    async decideCharge({ chargeId, input, actor, permissions, auditContext }) {
      const chargeStub = await prisma.bookingCharge.findUnique({
        where: { id: chargeId },
        select: { id: true, bookingId: true, booking: { select: { vehicleId: true } } },
      });
      if (!chargeStub) {
        throw new AppError(404, 'RENTAL_CHARGE_NOT_FOUND', 'Rental charge was not found.');
      }
      return runBookingTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, chargeStub.bookingId, chargeStub.booking.vehicleId);
        await assertCanAccessBooking(tx, booking, actor, permissions);
        assertNotFinalized(booking);
        const charge = await tx.bookingCharge.findUnique({
          where: { id: chargeId },
          include: { approvals: { orderBy: { occurredAt: 'asc' } } },
        });
        if (charge.approvalStatus !== 'PENDING') {
          throw new AppError(409, 'CHARGE_ALREADY_DECIDED', 'This charge already has a final approval decision.');
        }
        const now = new Date();
        const updated = await tx.bookingCharge.update({
          where: { id: chargeId },
          data: {
            approvalStatus: input.decision,
            approvedByStaffId: input.decision === 'APPROVED' ? actor.id : null,
            approvedAt: input.decision === 'APPROVED' ? now : null,
            recognizedAt: input.decision === 'APPROVED' ? now : null,
            ...(input.decision === 'REJECTED'
              ? { voidedAt: now, voidReason: input.reason }
              : {}),
          },
        });
        const approval = await tx.bookingChargeApproval.create({
          data: {
            bookingChargeId: chargeId,
            actorStaffId: actor.id,
            decision: input.decision,
            reason: input.reason,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: `rental.charge_${input.decision.toLowerCase()}`,
          entityType: 'BookingCharge',
          entityId: chargeId,
          ...auditContext,
          beforeSnapshot: { approvalStatus: charge.approvalStatus },
          afterSnapshot: {
            approvalStatus: updated.approvalStatus,
            amount: updated.amount.toString(),
            reason: input.reason,
            approvalId: approval.id,
          },
        });
        return mapCharge({
          ...updated,
          approvals: [...charge.approvals, approval],
        });
      });
    },

    async createDamage({ bookingId, input, actor, permissions, auditContext }) {
      const vehicleId = await bookingVehicleId(prisma, bookingId);
      return runBookingTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, bookingId, vehicleId);
        await assertCanAccessBooking(tx, booking, actor, permissions);
        assertNotFinalized(booking);
        if (!['HANDED_OVER', 'RETURNED'].includes(booking.status)) {
          throw new AppError(409, 'DAMAGE_REPORT_NOT_ALLOWED', 'Damage can be reported after vehicle handover.');
        }
        const inspection = await tx.rentalInspection.findUnique({
          where: { id: input.inspectionId },
          include: { handover: { select: { bookingId: true } }, rentalReturn: { include: { handover: { select: { bookingId: true } } } } },
        });
        const inspectionBookingId = inspection?.handover?.bookingId ??
          inspection?.rentalReturn?.handover?.bookingId;
        if (!inspection || inspectionBookingId !== bookingId) {
          throw new AppError(404, 'RENTAL_INSPECTION_NOT_FOUND', 'The inspection was not found for this booking.');
        }
        const [damage] = await createDamageReports(tx, {
          inspectionId: inspection.id,
          damages: [input],
          actor,
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'rental.damage_report_created',
          entityType: 'DamageReport',
          entityId: damage.id,
          ...auditContext,
          afterSnapshot: {
            bookingId,
            inspectionId: inspection.id,
            category: damage.category,
            severity: damage.severity,
            origin: damage.origin,
            chargeApprovalStatus: damage.chargeApprovalStatus,
          },
        });
        return {
          id: damage.id,
          inspectionId: damage.inspectionId,
          category: damage.category,
          severity: damage.severity,
          origin: damage.origin,
          status: damage.status,
          chargeApprovalStatus: damage.chargeApprovalStatus,
          description: damage.description,
          location: damage.location,
          estimatedRepairCost: damage.estimatedRepairCost?.toString() ?? null,
          createdAt: damage.createdAt,
        };
      });
    },

    async listDamages({ query, actor, permissions }) {
      const now = new Date();
      const baseWhere = baseAssignedWhere(actor, permissions, now);
      const where = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.chargeApprovalStatus ? { chargeApprovalStatus: query.chargeApprovalStatus } : {}),
        ...(query.search ? { description: { contains: query.search } } : {}),
      };
      if (Object.keys(baseWhere).length) {
        const assignedBookings = await prisma.booking.findMany({
          where: baseWhere,
          select: { id: true },
        });
        const bookingIds = assignedBookings.map(({ id }) => id);
        if (!bookingIds.length) return { items: [], page: query.page, limit: query.limit, total: 0 };
        where.inspection = {
          OR: [
            { handover: { is: { bookingId: { in: bookingIds } } } },
            {
              rentalReturn: {
                is: { handover: { is: { bookingId: { in: bookingIds } } } },
              },
            },
          ],
        };
      }
      const [damages, total] = await prisma.$transaction([
        prisma.damageReport.findMany({
          where,
          include: {
            inspection: {
              include: {
                handover: { select: { bookingId: true } },
                rentalReturn: { include: { handover: { select: { bookingId: true } } } },
              },
            },
            images: { orderBy: { createdAt: 'asc' } },
            approvals: { orderBy: { occurredAt: 'asc' } },
            charge: { select: { id: true, amount: true, approvalStatus: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.damageReport.count({ where }),
      ]);
      return {
        items: damages.map((damage) => ({
          id: damage.id,
          bookingId: damage.inspection.handover?.bookingId ??
            damage.inspection.rentalReturn?.handover?.bookingId,
          inspectionId: damage.inspectionId,
          stage: damage.inspection.stage,
          category: damage.category,
          severity: damage.severity,
          origin: damage.origin,
          status: damage.status,
          chargeApprovalStatus: damage.chargeApprovalStatus,
          description: damage.description,
          location: damage.location,
          estimatedRepairCost: damage.estimatedRepairCost?.toString() ?? null,
          approvedChargeAmount: damage.approvedChargeAmount?.toString() ?? null,
          createdAt: damage.createdAt,
          images: damage.images.map((image) => ({
            id: image.id,
            caption: image.caption,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes.toString(),
            contentUrl: `/api/v1/rental-operations/damages/${damage.id}/images/${image.id}`,
          })),
          approvals: damage.approvals,
          charge: damage.charge ? {
            id: damage.charge.id,
            amount: damage.charge.amount.toString(),
            approvalStatus: damage.charge.approvalStatus,
          } : null,
        })),
        page: query.page,
        limit: query.limit,
        total,
      };
    },

    async decideDamage({ damageId, input, actor, permissions, auditContext }) {
      const damageStub = await prisma.damageReport.findUnique({
        where: { id: damageId },
        select: {
          id: true,
          inspection: {
            select: {
              handover: { select: { bookingId: true, booking: { select: { vehicleId: true } } } },
              rentalReturn: {
                select: {
                  handover: { select: { bookingId: true, booking: { select: { vehicleId: true } } } },
                },
              },
            },
          },
        },
      });
      if (!damageStub) {
        throw new AppError(404, 'DAMAGE_REPORT_NOT_FOUND', 'Damage report was not found.');
      }
      const bookingRecord = damageStub.inspection.handover ??
        damageStub.inspection.rentalReturn?.handover;
      if (!bookingRecord) {
        throw new AppError(404, 'DAMAGE_REPORT_NOT_FOUND', 'Damage report was not found.');
      }
      const bookingId = bookingRecord.bookingId;
      const vehicleId = bookingRecord.booking.vehicleId;
      return runBookingTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, bookingId, vehicleId);
        await assertCanAccessBooking(tx, booking, actor, permissions);
        assertNotFinalized(booking);
        const damage = await tx.damageReport.findUnique({
          where: { id: damageId },
          include: { charge: true, approvals: { orderBy: { occurredAt: 'asc' } } },
        });
        if (damage.chargeApprovalStatus !== 'PENDING') {
          throw new AppError(409, 'DAMAGE_ALREADY_DECIDED', 'This damage charge already has a final decision.');
        }
        if (input.decision === 'APPROVED' && damage.origin !== 'NEW') {
          throw new AppError(409, 'PRE_EXISTING_DAMAGE_NOT_CHARGEABLE', 'Pre-existing damage cannot be charged to this rental.');
        }
        const now = new Date();
        let charge = null;
        if (input.decision === 'APPROVED') {
          const amount = requirePositiveAmount(input.approvedChargeAmount);
          if (damage.charge) {
            throw new AppError(409, 'DAMAGE_CHARGE_ALREADY_EXISTS', 'A charge already exists for this damage report.');
          }
          charge = await tx.bookingCharge.create({
            data: {
              bookingId,
              createdByStaffId: actor.id,
              approvedByStaffId: actor.id,
              damageReportId: damageId,
              idempotencyKey: `rental-damage:${damageId}`,
              chargeType: 'DAMAGE',
              direction: 'DEBIT',
              quantity: decimal(1),
              unitPrice: amount,
              amount,
              currency: booking.currency,
              description: `Approved damage charge: ${damage.description}`,
              approvalStatus: 'APPROVED',
              approvedAt: now,
              recognizedAt: now,
            },
          });
        }
        const updated = await tx.damageReport.update({
          where: { id: damageId },
          data: {
            chargeApprovalStatus: input.decision,
            status: 'ASSESSED',
            approvedChargeAmount: input.decision === 'APPROVED'
              ? decimal(input.approvedChargeAmount)
              : null,
            approvedByStaffId: actor.id,
            approvedAt: now,
          },
        });
        const approval = await tx.damageApproval.create({
          data: {
            damageReportId: damageId,
            actorStaffId: actor.id,
            decision: input.decision,
            chargeAmount: input.decision === 'APPROVED'
              ? decimal(input.approvedChargeAmount)
              : null,
            reason: input.reason,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: `rental.damage_charge_${input.decision.toLowerCase()}`,
          entityType: 'DamageReport',
          entityId: damageId,
          ...auditContext,
          beforeSnapshot: { chargeApprovalStatus: damage.chargeApprovalStatus },
          afterSnapshot: {
            chargeApprovalStatus: updated.chargeApprovalStatus,
            approvedChargeAmount: updated.approvedChargeAmount?.toString() ?? null,
            chargeId: charge?.id ?? null,
            approvalId: approval.id,
            reason: input.reason,
          },
        });
        return {
          id: updated.id,
          status: updated.status,
          chargeApprovalStatus: updated.chargeApprovalStatus,
          approvedChargeAmount: updated.approvedChargeAmount?.toString() ?? null,
          charge: charge ? mapCharge({ ...charge, approvals: [] }) : null,
        };
      });
    },

    async financialSummary({ bookingId, actor, permissions }) {
      const { booking, summary } = await findBookingFinancials(prisma, bookingId);
      await assertCanAccessBooking(prisma, booking, actor, permissions);
      return summary;
    },

    async applyDeposit({
      bookingId,
      input,
      actor,
      permissions,
      auditContext,
    }) {
      const vehicleId = await bookingVehicleId(prisma, bookingId);
      return runBookingTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, bookingId, vehicleId);
        await assertCanAccessBooking(tx, booking, actor, permissions);
        assertNotFinalized(booking);
        if (booking.status !== 'RETURNED') {
          throw new AppError(409, 'DEPOSIT_APPLICATION_NOT_ALLOWED', 'Security deposits can be applied after the vehicle return.');
        }
        const existing = await tx.depositApplication.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          if (existing.bookingId !== bookingId) {
            throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used.');
          }
          if (existing.bookingChargeId !== input.chargeId) {
            throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different charge.');
          }
          return {
            id: existing.id,
            bookingChargeId: existing.bookingChargeId,
            amount: existing.amount.toString(),
            reason: existing.reason,
            appliedAt: existing.appliedAt,
          };
        }
        const amount = requirePositiveAmount(input.amount);
        const charge = await tx.bookingCharge.findFirst({
          where: {
            id: input.chargeId,
            bookingId,
            direction: 'DEBIT',
            approvalStatus: 'APPROVED',
            voidedAt: null,
          },
        });
        if (!charge) {
          throw new AppError(404, 'APPROVED_CHARGE_NOT_FOUND', 'An approved debit charge for this booking was not found.');
        }
        const { summary } = await findBookingFinancials(tx, bookingId);
        const existingApplications = await tx.depositApplication.findMany({
          where: { bookingChargeId: charge.id },
          select: { amount: true },
        });
        const alreadyApplied = existingApplications.reduce(
          (total, application) => total.plus(decimal(application.amount)),
          decimal(0),
        );
        const remainingCharge = decimal(charge.amount).minus(alreadyApplied);
        if (
          amount.greaterThan(decimal(summary.securityDepositHeld)) ||
          amount.greaterThan(decimal(summary.rentalOutstanding)) ||
          amount.greaterThan(remainingCharge)
        ) {
          throw new AppError(409, 'DEPOSIT_APPLICATION_EXCEEDS_BALANCE', 'Deposit application cannot exceed the available deposit or outstanding approved charge.');
        }
        const application = await tx.depositApplication.create({
          data: {
            bookingId,
            bookingChargeId: charge.id,
            createdByStaffId: actor.id,
            idempotencyKey: input.idempotencyKey,
            amount,
            reason: input.reason,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'rental.security_deposit_applied',
          entityType: 'DepositApplication',
          entityId: application.id,
          ...auditContext,
          afterSnapshot: {
            bookingId,
            bookingChargeId: charge.id,
            amount: amount.toString(),
            reason: input.reason,
          },
        });
        return {
          id: application.id,
          bookingChargeId: application.bookingChargeId,
          amount: application.amount.toString(),
          reason: application.reason,
          appliedAt: application.appliedAt,
        };
      });
    },

    async createPayment({ bookingId, input, actor, permissions, auditContext }) {
      const vehicleId = await bookingVehicleId(prisma, bookingId);
      return runBookingTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, bookingId, vehicleId);
        await assertCanAccessBooking(tx, booking, actor, permissions);
        assertNotFinalized(booking);
        const existing = await tx.payment.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { allocations: true, receipts: true },
        });
        if (existing) {
          if (existing.bookingId !== bookingId) {
            throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used.');
          }
          return mapPayment(existing);
        }

        const amount = requirePositiveAmount(input.amount);
        const allocations = input.allocations.map((allocation) => ({
          allocationType: allocation.allocationType,
          amount: requirePositiveAmount(allocation.amount),
        }));
        const allocatedTotal = allocationTotal(allocations);
        if (!allocatedTotal.equals(amount)) {
          throw new AppError(400, 'PAYMENT_ALLOCATION_MISMATCH', 'Payment allocations must add up to the recorded payment amount.');
        }
        if (input.currency !== booking.currency) {
          throw new AppError(400, 'PAYMENT_CURRENCY_MISMATCH', 'Payment currency must match the booking currency.');
        }
        if (input.purpose === 'SECURITY_DEPOSIT' && allocations.some(({ allocationType }) => allocationType !== 'SECURITY_DEPOSIT')) {
          throw new AppError(400, 'PAYMENT_PURPOSE_MISMATCH', 'Security-deposit payments must be allocated only to the deposit.');
        }
        if (
          input.purpose !== 'SECURITY_DEPOSIT' &&
          input.purpose !== 'OTHER' &&
          allocations.some(({ allocationType }) => allocationType !== 'RENTAL')
        ) {
          throw new AppError(400, 'PAYMENT_PURPOSE_MISMATCH', 'Advance, partial, and final payments must be allocated to rental charges.');
        }

        const { summary } = await findBookingFinancials(tx, bookingId);
        const rentalAllocation = allocations
          .filter(({ allocationType }) => allocationType === 'RENTAL')
          .reduce((total, allocation) => total.plus(allocation.amount), decimal(0));
        if (
          rentalAllocation.greaterThan(0) &&
          rentalAllocation.greaterThan(decimal(summary.rentalOutstanding).greaterThan(0)
            ? decimal(summary.rentalOutstanding)
            : decimal(0))
        ) {
          throw new AppError(409, 'RENTAL_OVERPAYMENT', 'Rental payment allocations cannot exceed the current outstanding rental balance.');
        }
        const depositAllocation = allocations
          .filter(({ allocationType }) => allocationType === 'SECURITY_DEPOSIT')
          .reduce((total, allocation) => total.plus(allocation.amount), decimal(0));
        const depositOutstanding = decimal(summary.securityDepositOutstanding);
        if (depositAllocation.greaterThan(depositOutstanding)) {
          throw new AppError(409, 'DEPOSIT_OVERPAYMENT', 'Deposit collections cannot exceed the booking security-deposit requirement.');
        }
        const transactionAt = input.transactionAt ? mapDate(input.transactionAt) : new Date();
        if (transactionAt > new Date()) {
          throw new AppError(400, 'PAYMENT_TIME_CANNOT_BE_FUTURE', 'Payment time cannot be in the future.');
        }
        const payment = await tx.payment.create({
          data: {
            bookingId,
            recordedByStaffId: actor.id,
            direction: 'COLLECTION',
            purpose: input.purpose,
            status: 'COMPLETED',
            method: input.method,
            amount,
            currency: booking.currency,
            reference: input.reference ?? null,
            idempotencyKey: input.idempotencyKey,
            notes: input.notes ?? null,
            transactionAt,
            settledAt: new Date(),
            allocations: {
              create: allocations.map((allocation) => ({
                allocationType: allocation.allocationType,
                amount: allocation.amount,
              })),
            },
          },
          include: { allocations: true, receipts: true },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'rental.payment_recorded',
          entityType: 'Payment',
          entityId: payment.id,
          ...auditContext,
          afterSnapshot: {
            bookingId,
            direction: payment.direction,
            purpose: payment.purpose,
            method: payment.method,
            amount: payment.amount.toString(),
            currency: payment.currency,
            reference: payment.reference,
            allocations: payment.allocations.map((allocation) => ({
              allocationType: allocation.allocationType,
              amount: allocation.amount.toString(),
            })),
          },
        });
        return mapPayment(payment);
      });
    },

    async refundPayment({
      bookingId,
      paymentId,
      input,
      actor,
      permissions,
      auditContext,
    }) {
      const vehicleId = await bookingVehicleId(prisma, bookingId);
      return runBookingTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, bookingId, vehicleId);
        await assertCanAccessBooking(tx, booking, actor, permissions);
        assertNotFinalized(booking);
        const existing = await tx.payment.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { allocations: true, receipts: true },
        });
        if (existing) {
          if (existing.bookingId !== bookingId) {
            throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used.');
          }
          if (existing.originalPaymentId !== paymentId) {
            throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different payment.');
          }
          return mapPayment(existing);
        }
        const original = await tx.payment.findFirst({
          where: {
            id: paymentId,
            bookingId,
            direction: 'COLLECTION',
            status: 'COMPLETED',
          },
          include: {
            allocations: true,
            refunds: {
              where: { status: 'COMPLETED' },
              include: { allocations: true },
            },
          },
        });
        if (!original) {
          throw new AppError(404, 'PAYMENT_NOT_FOUND', 'The original collection was not found.');
        }
        const allocations = input.allocations.map((allocation) => ({
          allocationType: allocation.allocationType,
          amount: requirePositiveAmount(allocation.amount),
        }));
        const amount = requirePositiveAmount(input.amount);
        if (!allocationTotal(allocations).equals(amount)) {
          throw new AppError(400, 'PAYMENT_ALLOCATION_MISMATCH', 'Refund allocations must add up to the refund amount.');
        }
        const { summary } = await findBookingFinancials(tx, bookingId);
        const originalAllocated = new Map(
          original.allocations.map(({ allocationType, amount: value }) => [
            allocationType,
            decimal(value),
          ]),
        );
        const previouslyRefunded = new Map();
        for (const refund of original.refunds) {
          for (const allocation of refund.allocations) {
            previouslyRefunded.set(
              allocation.allocationType,
              (previouslyRefunded.get(allocation.allocationType) ?? decimal(0))
                .plus(decimal(allocation.amount)),
            );
          }
        }
        const rentalRefundable = decimal(summary.rentalReceived).minus(
          decimal(summary.rentalCharges)
            .minus(decimal(summary.securityDepositApplied))
            .greaterThan(0)
            ? decimal(summary.rentalCharges).minus(decimal(summary.securityDepositApplied))
            : decimal(0),
        );
        for (const allocation of allocations) {
          const originalRemaining = (originalAllocated.get(allocation.allocationType) ?? decimal(0))
            .minus(previouslyRefunded.get(allocation.allocationType) ?? decimal(0));
          if (allocation.amount.greaterThan(originalRemaining)) {
            throw new AppError(409, 'REFUND_EXCEEDS_ORIGINAL_PAYMENT', 'Refund cannot exceed the remaining amount allocated in the original collection.');
          }
          if (
            allocation.allocationType === 'SECURITY_DEPOSIT' &&
            allocation.amount.greaterThan(decimal(summary.securityDepositHeld))
          ) {
            throw new AppError(409, 'DEPOSIT_REFUND_EXCEEDS_BALANCE', 'Refund cannot exceed the unapplied security-deposit balance.');
          }
          if (
            allocation.allocationType === 'RENTAL' &&
            (!rentalRefundable.greaterThan(0) || allocation.amount.greaterThan(rentalRefundable))
          ) {
            throw new AppError(409, 'RENTAL_REFUND_EXCEEDS_CREDIT', 'Rental refunds cannot exceed the available rental credit.');
          }
        }
        const transactionAt = input.transactionAt ? mapDate(input.transactionAt) : new Date();
        if (transactionAt > new Date()) {
          throw new AppError(400, 'PAYMENT_TIME_CANNOT_BE_FUTURE', 'Refund time cannot be in the future.');
        }
        const refundPurpose = allocations.length === 1 &&
          allocations[0].allocationType === 'SECURITY_DEPOSIT'
          ? 'SECURITY_DEPOSIT'
          : allocations.length === 1
            ? original.purpose
            : 'OTHER';
        const refund = await tx.payment.create({
          data: {
            bookingId,
            recordedByStaffId: actor.id,
            originalPaymentId: paymentId,
            direction: 'REFUND',
            purpose: refundPurpose,
            status: 'COMPLETED',
            method: input.method,
            amount,
            currency: booking.currency,
            reference: input.reference ?? null,
            idempotencyKey: input.idempotencyKey,
            notes: input.reason,
            transactionAt,
            settledAt: new Date(),
            allocations: {
              create: allocations.map((allocation) => ({
                allocationType: allocation.allocationType,
                amount: allocation.amount,
              })),
            },
          },
          include: { allocations: true, receipts: true },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'rental.payment_refunded',
          entityType: 'Payment',
          entityId: refund.id,
          ...auditContext,
          afterSnapshot: {
            bookingId,
            originalPaymentId: paymentId,
            amount: amount.toString(),
            currency: booking.currency,
            method: input.method,
            reference: input.reference ?? null,
            reason: input.reason,
            allocations: allocations.map((allocation) => ({
              allocationType: allocation.allocationType,
              amount: allocation.amount.toString(),
            })),
          },
        });
        return mapPayment(refund);
      });
    },

    async correctPayment({
      bookingId,
      paymentId,
      reason,
      actor,
      permissions,
      auditContext,
    }) {
      const vehicleId = await bookingVehicleId(prisma, bookingId);
      return runBookingTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, bookingId, vehicleId);
        await assertCanAccessBooking(tx, booking, actor, permissions);
        assertNotFinalized(booking);
        const payment = await tx.payment.findFirst({
          where: { id: paymentId, bookingId },
          include: {
            allocations: true,
            refunds: { where: { status: 'COMPLETED' }, select: { id: true } },
          },
        });
        if (!payment) {
          throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found.');
        }
        if (payment.status !== 'COMPLETED' || payment.direction !== 'COLLECTION' || payment.refunds.length) {
          throw new AppError(409, 'PAYMENT_CANNOT_BE_CORRECTED', 'Only completed collections without refunds can be corrected.');
        }
        const depositAmount = payment.allocations
          .filter(({ allocationType }) => allocationType === 'SECURITY_DEPOSIT')
          .reduce((total, allocation) => total.plus(decimal(allocation.amount)), decimal(0));
        if (depositAmount.greaterThan(0)) {
          const { summary } = await findBookingFinancials(tx, bookingId);
          const remainingAfterCorrection = decimal(summary.securityDepositCollected).minus(depositAmount);
          if (remainingAfterCorrection.lessThan(decimal(summary.securityDepositApplied))) {
            throw new AppError(409, 'DEPOSIT_ALREADY_APPLIED', 'This deposit has already been applied to rental charges and cannot be corrected.');
          }
        }
        const now = new Date();
        const updated = await tx.payment.update({
          where: { id: paymentId },
          data: { status: 'VOIDED', voidedAt: now },
          include: { allocations: true, receipts: true },
        });
        await tx.paymentCorrection.create({
          data: {
            paymentId,
            actorStaffId: actor.id,
            previousStatus: payment.status,
            newStatus: 'VOIDED',
            reason,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'rental.payment_corrected',
          entityType: 'Payment',
          entityId: paymentId,
          ...auditContext,
          beforeSnapshot: {
            status: payment.status,
            amount: payment.amount.toString(),
            direction: payment.direction,
          },
          afterSnapshot: {
            status: updated.status,
            voidedAt: updated.voidedAt,
            reason,
          },
        });
        return mapPayment(updated);
      });
    },

    async uploadPaymentReceipt({
      bookingId,
      paymentId,
      file,
      actor,
      permissions,
      auditContext,
    }) {
      const inspected = await inspectVehicleUpload(file, 'document');
      const upload = { ...inspected, storageKey: makeUploadKey(inspected, 'rental-receipts') };
      const storedKeys = await storeUploads(storage, [upload]);
      try {
        const receipt = await runBookingTransaction(prisma, async (tx) => {
          const vehicleId = await bookingVehicleId(tx, bookingId);
          const booking = await lockBooking(tx, bookingId, vehicleId);
          await assertCanAccessBooking(tx, booking, actor, permissions);
          const payment = await tx.payment.findFirst({
            where: { id: paymentId, bookingId },
            select: { id: true, status: true },
          });
          if (!payment || payment.status !== 'COMPLETED') {
            throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Completed payment was not found.');
          }
          const created = await tx.paymentReceipt.create({
            data: {
              paymentId,
              storageKey: upload.storageKey,
              originalName: upload.originalName,
              mimeType: upload.mimeType,
              sizeBytes: upload.sizeBytes,
            },
          });
          await writeAudit(tx, {
            ...actorAuditFields(actor),
            action: 'rental.payment_receipt_uploaded',
            entityType: 'Payment',
            entityId: paymentId,
            ...auditContext,
            afterSnapshot: {
              receiptId: created.id,
              mimeType: created.mimeType,
              sizeBytes: created.sizeBytes.toString(),
            },
          });
          return {
            id: created.id,
            originalName: created.originalName,
            mimeType: created.mimeType,
            sizeBytes: created.sizeBytes.toString(),
            uploadedAt: created.uploadedAt,
          };
        });
        return receipt;
      } catch (error) {
        await cleanupStoredUploads(storage, storedKeys, error);
        throw error;
      }
    },

    async finalizeRental({ bookingId, notes, actor, permissions, auditContext }) {
      const vehicleId = await bookingVehicleId(prisma, bookingId);
      await runBookingTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, bookingId, vehicleId);
        await assertCanAccessBooking(tx, booking, actor, permissions);
        const existing = await tx.rentalFinalization.findUnique({ where: { bookingId } });
        if (existing) return;
        if (booking.status !== 'RETURNED') {
          throw new AppError(409, 'RETURN_REQUIRED', 'Complete and inspect the vehicle return before finalizing the rental.');
        }
        const rentalReturn = await tx.rentalReturn.findFirst({
          where: { handover: { is: { bookingId } } },
          select: { id: true },
        });
        if (!rentalReturn) {
          throw new AppError(409, 'RETURN_REQUIRED', 'A completed vehicle return is required before finalization.');
        }
        const pendingCharges = await tx.bookingCharge.findMany({
          where: { bookingId, approvalStatus: 'PENDING', voidedAt: null },
          select: { id: true },
        });
        if (pendingCharges.length) {
          throw new AppError(409, 'PENDING_CHARGE_DECISIONS', 'Approve or reject all proposed charges before finalizing the rental.');
        }
        const pendingDamages = await tx.damageReport.findMany({
          where: {
            chargeApprovalStatus: 'PENDING',
            origin: 'NEW',
            inspection: {
              OR: [
                { handover: { is: { bookingId } } },
                { rentalReturn: { is: { handover: { is: { bookingId } } } } },
              ],
            },
          },
          select: { id: true },
        });
        if (pendingDamages.length) {
          throw new AppError(409, 'PENDING_DAMAGE_DECISIONS', 'Resolve all customer-damage charge decisions before finalizing the rental.');
        }

        const { summary } = await findBookingFinancials(tx, bookingId);
        if (decimal(summary.securityDepositHeld).greaterThan(0)) {
          throw new AppError(409, 'SECURITY_DEPOSIT_UNSETTLED', 'Refund or apply the remaining security deposit before finalizing the rental.');
        }
        const policy = await getPolicy(tx);
        const outstanding = decimal(summary.rentalOutstanding);
        if (outstanding.greaterThan(0) && !policy.allowOutstandingBalanceAtFinalization) {
          throw new AppError(409, 'OUTSTANDING_BALANCE', `Collect or apply the outstanding rental balance of ${outstanding.toFixed(2)} ${booking.currency} before finalization.`);
        }
        if (outstanding.lessThan(0)) {
          throw new AppError(409, 'RENTAL_CREDIT_REQUIRES_REFUND', 'Resolve the rental credit before finalizing the rental.');
        }

        const finalization = await tx.rentalFinalization.create({
          data: {
            bookingId,
            finalizedByStaffId: actor.id,
            rentalChargeTotal: decimal(summary.rentalCharges),
            rentalPaymentsReceived: decimal(summary.rentalReceived),
            rentalOutstanding: decimal(summary.rentalOutstanding),
            securityDepositCollected: decimal(summary.securityDepositCollected),
            securityDepositApplied: decimal(summary.securityDepositApplied),
            securityDepositRefunded: decimal(summary.securityDepositRefunded),
            remainingDeposit: decimal(summary.remainingDeposit),
            outstandingBalanceAllowed: outstanding.greaterThan(0),
            notes: notes ?? null,
            financialSnapshot: toJsonValue(summary),
          },
        });
        const now = new Date();
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'COMPLETED' },
        });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId,
            changedByStaffId: actor.id,
            fromStatus: 'RETURNED',
            toStatus: 'COMPLETED',
            reason: notes ?? 'Rental operational and financial close-out completed.',
            occurredAt: now,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'rental.finalized',
          entityType: 'Booking',
          entityId: bookingId,
          ...auditContext,
          afterSnapshot: {
            finalizationId: finalization.id,
            status: 'COMPLETED',
            financialSnapshot: toJsonValue(summary),
          },
        });
      });
      return loadRentalDetail(bookingId, actor, permissions);
    },

    async listCustomerDocuments({ customerId }) {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true },
      });
      if (!customer) {
        throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer was not found.');
      }
      const documents = await prisma.customerDocument.findMany({
        where: { customerId, archivedAt: null },
        orderBy: [{ documentType: 'asc' }, { uploadedAt: 'desc' }],
        select: {
          id: true,
          documentType: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          expiresAt: true,
          uploadedAt: true,
        },
      });
      return documents.map((document) => ({
        ...document,
        sizeBytes: document.sizeBytes.toString(),
      }));
    },

    async downloadCustomerDocument({ customerId, documentId }) {
      const document = await prisma.customerDocument.findFirst({
        where: { id: documentId, customerId, archivedAt: null },
        select: {
          storageKey: true,
          originalName: true,
          mimeType: true,
          sha256: true,
        },
      });
      if (!document) {
        throw new AppError(404, 'CUSTOMER_DOCUMENT_NOT_FOUND', 'Customer document was not found.');
      }
      return { ...document, buffer: await storage.get(document.storageKey) };
    },

    async downloadOperationPhoto({ bookingId, photoId, actor, permissions }) {
      let photo = await prisma.inspectionPhoto.findFirst({
        where: {
          id: photoId,
          OR: [
            { inspection: { handover: { is: { bookingId } } } },
            { inspection: { rentalReturn: { is: { handover: { is: { bookingId } } } } } },
          ],
        },
        select: {
          storageKey: true,
          mimeType: true,
          sha256: true,
          inspection: {
            select: {
              handover: { select: { booking: { select: { vehicleId: true } } } },
              rentalReturn: {
                select: { handover: { select: { booking: { select: { vehicleId: true } } } } },
              },
            },
          },
        },
      });
      if (!photo) {
        photo = await prisma.rentalOperationDraftPhoto.findFirst({
          where: { id: photoId, draft: { bookingId } },
          select: {
            storageKey: true,
            mimeType: true,
            sha256: true,
            draft: { select: { booking: { select: { vehicleId: true } } } },
          },
        });
      }
      if (!photo) {
        throw new AppError(404, 'INSPECTION_PHOTO_NOT_FOUND', 'Inspection photograph was not found.');
      }
      const vehicleId = photo.inspection
        ? photo.inspection.handover?.booking.vehicleId ??
          photo.inspection.rentalReturn?.handover.booking.vehicleId
        : photo.draft.booking.vehicleId;
      const booking = { id: bookingId, vehicleId };
      await assertCanAccessBooking(prisma, booking, actor, permissions);
      return { ...photo, buffer: await storage.get(photo.storageKey) };
    },

    async uploadDamageImage({
      damageId,
      files,
      caption,
      actor,
      permissions,
      auditContext,
    }) {
      if (!files?.length) {
        throw new AppError(400, 'UPLOAD_REQUIRED', 'Select at least one damage photograph.');
      }
      const inspected = await Promise.all(files.map((file) => inspectVehicleUpload(file, 'image')));
      const uploads = inspected.map((upload) => ({
        ...upload,
        storageKey: makeUploadKey(upload, 'rental-damage'),
      }));
      const storedKeys = await storeUploads(storage, uploads);
      try {
        return await prisma.$transaction(async (tx) => {
          const damage = await tx.damageReport.findUnique({
            where: { id: damageId },
            include: {
              inspection: {
                include: {
                  handover: { select: { bookingId: true, booking: { select: { vehicleId: true } } } },
                  rentalReturn: {
                    include: { handover: { select: { bookingId: true, booking: { select: { vehicleId: true } } } } },
                  },
                },
              },
            },
          });
          if (!damage) {
            throw new AppError(404, 'DAMAGE_REPORT_NOT_FOUND', 'Damage report was not found.');
          }
          const bookingRecord = damage.inspection.handover ??
            damage.inspection.rentalReturn?.handover;
          if (!bookingRecord) {
            throw new AppError(404, 'DAMAGE_REPORT_NOT_FOUND', 'Damage report was not found.');
          }
          const booking = await lockBooking(tx, bookingRecord.bookingId, bookingRecord.booking.vehicleId);
          await assertCanAccessBooking(tx, booking, actor, permissions);
          const existingCount = await tx.damageImage.count({ where: { damageReportId: damageId } });
          if (existingCount + uploads.length > 30) {
            throw new AppError(409, 'DAMAGE_IMAGE_LIMIT', 'A damage report can have at most 30 photographs.');
          }
          const images = [];
          for (const upload of uploads) {
            images.push(await tx.damageImage.create({
              data: {
                damageReportId: damageId,
                uploadedByStaffId: actor.id,
                storageKey: upload.storageKey,
                caption: caption?.trim().slice(0, 255) || null,
                mimeType: upload.mimeType,
                sizeBytes: upload.sizeBytes,
                sha256: upload.sha256,
              },
            }));
          }
          await writeAudit(tx, {
            ...actorAuditFields(actor),
            action: 'rental.damage_photo_uploaded',
            entityType: 'DamageReport',
            entityId: damageId,
            ...auditContext,
            afterSnapshot: {
              imageIds: images.map(({ id }) => id),
            },
          });
          return images.map((image) => ({
            id: image.id,
            caption: image.caption,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes.toString(),
            contentUrl: `/api/v1/rental-operations/damages/${damageId}/images/${image.id}`,
          }));
        });
      } catch (error) {
        await cleanupStoredUploads(storage, storedKeys, error);
        throw error;
      }
    },

    async downloadDamageImage({ damageId, imageId, actor, permissions }) {
      const image = await prisma.damageImage.findFirst({
        where: { id: imageId, damageReportId: damageId },
        select: {
          storageKey: true,
          mimeType: true,
          sha256: true,
          damageReport: {
            select: {
              inspection: {
                select: {
                  handover: { select: { bookingId: true, booking: { select: { vehicleId: true } } } },
                  rentalReturn: {
                    select: { handover: { select: { bookingId: true, booking: { select: { vehicleId: true } } } } },
                  },
                },
              },
            },
          },
        },
      });
      if (!image) {
        throw new AppError(404, 'DAMAGE_PHOTO_NOT_FOUND', 'Damage photograph was not found.');
      }
      const bookingRecord = image.damageReport.inspection.handover ??
        image.damageReport.inspection.rentalReturn?.handover;
      if (!bookingRecord) {
        throw new AppError(404, 'DAMAGE_PHOTO_NOT_FOUND', 'Damage photograph was not found.');
      }
      await assertCanAccessBooking(prisma, {
        id: bookingRecord.bookingId,
        vehicleId: bookingRecord.booking.vehicleId,
      }, actor, permissions);
      return { ...image, buffer: await storage.get(image.storageKey) };
    },

    async downloadPaymentReceipt({ bookingId, paymentId, receiptId, actor, permissions }) {
      const receipt = await prisma.paymentReceipt.findFirst({
        where: { id: receiptId, paymentId, payment: { bookingId } },
        select: {
          storageKey: true,
          originalName: true,
          mimeType: true,
          payment: {
            select: { booking: { select: { id: true, vehicleId: true } } },
          },
        },
      });
      if (!receipt) {
        throw new AppError(404, 'PAYMENT_RECEIPT_NOT_FOUND', 'Payment receipt was not found.');
      }
      await assertCanAccessBooking(prisma, receipt.payment.booking, actor, permissions);
      return { ...receipt, buffer: await storage.get(receipt.storageKey) };
    },

    async uploadOperationPhotos({
      bookingId,
      operation,
      files,
      caption,
      actor,
      permissions,
      auditContext,
    }) {
      if (!files?.length) {
        throw new AppError(400, 'UPLOAD_REQUIRED', 'Select at least one inspection photograph.');
      }
      const inspected = await Promise.all(files.map((file) => inspectVehicleUpload(file, 'image')));
      const uploads = inspected.map((upload) => ({
        ...upload,
        storageKey: makeUploadKey(upload, 'rental-inspection'),
      }));
      const storedKeys = await storeUploads(storage, uploads);
      try {
        return await runBookingTransaction(prisma, async (tx) => {
          const vehicleId = await bookingVehicleId(tx, bookingId);
          const booking = await lockBooking(tx, bookingId, vehicleId);
          await assertCanAccessBooking(tx, booking, actor, permissions);
          assertOperationStatus(booking, operation);
          const draft = await tx.rentalOperationDraft.findUnique({
            where: {
              bookingId_operationType: {
                bookingId,
                operationType: toOperationType(operation),
              },
            },
          });
          if (!draft) {
            throw new AppError(404, 'RENTAL_OPERATION_DRAFT_NOT_FOUND', 'Start the operation before uploading photographs.');
          }
          const currentPhotoCount = await tx.rentalOperationDraftPhoto.count({
            where: { draftId: draft.id },
          });
          if (currentPhotoCount + uploads.length > 100) {
            throw new AppError(409, 'INSPECTION_PHOTO_LIMIT', 'An operation can have at most 100 photographs.');
          }
          const photos = [];
          for (const upload of uploads) {
            photos.push(await tx.rentalOperationDraftPhoto.create({
              data: {
                draftId: draft.id,
                uploadedByStaffId: actor.id,
                storageKey: upload.storageKey,
                caption: caption?.trim().slice(0, 255) || null,
                mimeType: upload.mimeType,
                sizeBytes: upload.sizeBytes,
                sha256: upload.sha256,
              },
            }));
          }
          await writeAudit(tx, {
            ...actorAuditFields(actor),
            action: `rental.${operation}.photos_uploaded`,
            entityType: 'Booking',
            entityId: bookingId,
            ...auditContext,
            afterSnapshot: { draftId: draft.id, photoIds: photos.map(({ id }) => id) },
          });
          return photos.map((photo) => mapPhoto(photo, bookingId));
        });
      } catch (error) {
        await cleanupStoredUploads(storage, storedKeys, error);
        throw error;
      }
    },
  };
}
