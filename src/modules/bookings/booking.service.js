import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../shared/errors.js';
import {
  assertVehicleAvailable,
  blockingAvailabilityBlockWhere,
  blockingMaintenanceWhere,
  dateAvailabilityWhere,
} from '../../shared/vehicle-availability.js';
import { writeAudit } from '../../shared/audit.js';
import {
  assertAssignedVehicle,
  bookingVehicleId,
  lockBooking,
  lockVehicle,
  lockVehicles,
  runBookingTransaction as runTransaction,
} from '../../shared/booking-transaction.js';
import { findActiveRentalPolicy as activeRentalPolicy } from '../../shared/rental-policy.js';
import { calculateRentalFinancialSummary } from '../../shared/rental-finance.js';
import { allocateBookingReference } from './booking-reference.js';
import { decimal, priceQuote } from './booking-pricing.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const allowedTransitions = Object.freeze({
  PENDING: new Set(['UNDER_REVIEW', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED']),
  UNDER_REVIEW: new Set(['CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED']),
  CONFIRMED: new Set(['CANCELLED', 'NO_SHOW', 'HANDED_OVER']),
  HANDED_OVER: new Set(['RETURNED']),
  RETURNED: new Set(['COMPLETED']),
});

function actorAuditFields(actor) {
  return {
    actorStaffUserId: actor?.id ?? null,
    actorIdentifierSnapshot: actor?.email ?? (actor ? null : 'public-customer'),
  };
}

function hasPermission(permissions, permission) {
  return permissions?.includes(permission) ?? false;
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function hashLookupToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function omitFields(record, fields) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !fields.includes(key)));
}

function compareHashes(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function validateNewRentalDates(pickupAt, returnAt, now, policy) {
  if (pickupAt <= now) {
    throw new AppError(400, 'PICKUP_MUST_BE_IN_FUTURE', 'Pickup must be in the future.');
  }
  if (returnAt <= pickupAt) {
    throw new AppError(400, 'INVALID_RENTAL_PERIOD', 'Return must be later than pickup.');
  }
  const minimumHours = policy?.minimumRentalHours ?? 1;
  if (returnAt.getTime() - pickupAt.getTime() < minimumHours * 60 * 60 * 1000) {
    throw new AppError(
      400,
      'RENTAL_PERIOD_TOO_SHORT',
      `The minimum rental period is ${minimumHours} hour${minimumHours === 1 ? '' : 's'}.`,
    );
  }
  if (policy?.maximumAdvanceDays != null) {
    const latestPickup = new Date(now.getTime() + policy.maximumAdvanceDays * DAY_MS);
    if (pickupAt > latestPickup) {
      throw new AppError(
        400,
        'PICKUP_TOO_FAR_IN_ADVANCE',
        'The selected pickup date is beyond the current booking policy limit.',
      );
    }
  }
}

async function findRate(tx, { vehicleId, vehicleRateId, rentalPackageId, pickupAt }) {
  const rate = await tx.vehicleRate.findFirst({
    where: {
      id: vehicleRateId,
      vehicleId,
      rentalPackageId,
      isActive: true,
      effectiveFrom: { lte: pickupAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: pickupAt } }],
      rentalPackage: { isActive: true },
      vehicle: { status: 'ACTIVE', archivedAt: null },
    },
    include: { rentalPackage: true },
  });
  if (!rate) {
    throw new AppError(
      409,
      'VEHICLE_RATE_UNAVAILABLE',
      'The selected rental rate is not active for this vehicle and pickup date.',
    );
  }
  return rate;
}

async function createCustomer(tx, input, actor, permissions, auditContext) {
  if (input.customerId) {
    if (actor && !hasPermission(permissions, 'customers.view')) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to select customers.');
    }
    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, status: 'ACTIVE', archivedAt: null },
      select: { id: true, fullName: true, mobileNumber: true, email: true },
    });
    if (!customer) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'The selected customer was not found.');
    }
    return customer;
  }
  if (actor && !hasPermission(permissions, 'customers.create')) {
    throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to register a customer.');
  }
  const customer = await tx.customer.create({
    data: {
      fullName: input.customer.fullName,
      mobileNumber: input.customer.mobileNumber,
      email: input.customer.email || null,
    },
    select: { id: true, fullName: true, mobileNumber: true, email: true },
  });
  if (actor) {
    await writeAudit(tx, {
      ...actorAuditFields(actor),
      action: 'customer.created_from_booking',
      entityType: 'Customer',
      entityId: customer.id,
      ...auditContext,
      afterSnapshot: { source: 'STAFF_PORTAL' },
    });
  }
  return customer;
}

function chargeData({ bookingId, actor, currency, adjustment }) {
  return {
    bookingId,
    createdByStaffId: actor?.id ?? null,
    chargeType: adjustment.chargeType,
    direction: adjustment.direction,
    amount: decimal(adjustment.amount),
    currency,
    description: adjustment.description,
    pricingRuleSnapshot: adjustment.pricingRuleSnapshot ?? null,
    isInitialQuoteLine: true,
  };
}

async function createQuoteLines(tx, { bookingId, actor, currency, packageName, quote, adjustments }) {
  await tx.bookingCharge.create({
    data: {
      bookingId,
      createdByStaffId: actor?.id ?? null,
      chargeType: 'RENTAL',
      direction: 'DEBIT',
      quantity: decimal(quote.units),
      unitPrice: decimal(quote.rentalAmount).div(quote.units).toDecimalPlaces(2),
      amount: decimal(quote.rentalAmount),
      currency,
      description: `${packageName} × ${quote.units}`,
      isInitialQuoteLine: true,
    },
  });
  if (adjustments.length) {
    await tx.bookingCharge.createMany({
      data: adjustments.map((adjustment) => chargeData({
        bookingId,
        actor,
        currency,
        adjustment,
      })),
    });
  }
}

function bookingInclude() {
  return {
    customer: {
      select: { id: true, fullName: true, mobileNumber: true, email: true },
    },
    vehicle: {
      select: {
        id: true,
        registrationNumber: true,
        specification: {
          select: { make: true, model: true, variant: true, manufacturingYear: true, category: true },
        },
        images: {
          where: { archivedAt: null, isPublished: true },
          select: { id: true, caption: true, isPrimary: true },
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
          take: 1,
        },
      },
    },
    rentalPackage: { select: { id: true, code: true, name: true, rentalPeriod: true, durationCount: true } },
    rentalPolicy: { select: { id: true, version: true, rentalTerms: true, cancellationTerms: true } },
    createdBy: { select: { id: true, displayName: true } },
    confirmedBy: { select: { id: true, displayName: true } },
    statusHistory: {
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      include: { actor: { select: { id: true, displayName: true } } },
    },
    scheduleChanges: {
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      include: { changedBy: { select: { id: true, displayName: true } } },
    },
    charges: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    payments: {
      orderBy: [{ transactionAt: 'desc' }, { id: 'desc' }],
      include: { allocations: true },
    },
    depositApplications: { orderBy: { appliedAt: 'desc' } },
    handover: {
      include: {
        return: true,
        inspections: {
          select: {
            id: true,
            stage: true,
            inspectedAt: true,
            conditionSummary: true,
            customerAcknowledgedAt: true,
            acknowledgementMethod: true,
            damages: {
              select: {
                id: true,
                category: true,
                severity: true,
                origin: true,
                status: true,
                description: true,
                location: true,
              },
            },
          },
        },
      },
    },
  };
}

function mapBooking(record, permissions, { publicView = false } = {}) {
  const canSeeCustomer = publicView || hasPermission(permissions, 'customers.view');
  const canSeeFinancials =
    publicView ||
    hasPermission(permissions, 'bookings.pricing.view') ||
    hasPermission(permissions, 'payments.view');
  const canSeeInternal = !publicView && hasPermission(permissions, 'bookings.view');
  const canSeeOperations = !publicView && (
    hasPermission(permissions, 'handover.view') ||
    hasPermission(permissions, 'returns.view')
  );
  const recordWithoutToken = { ...record };
  delete recordWithoutToken.publicLookupTokenHash;
  const {
    customerNameSnapshot,
    customerMobileSnapshot,
    customerEmailSnapshot,
    internalNotes,
    customerNotes,
    charges,
    payments,
    depositApplications,
    ...booking
  } = recordWithoutToken;
  const mapped = {
    ...booking,
    rentalDurationUnits: record.rentalDurationUnits.toString(),
    rentalPriceSnapshot: record.rentalPriceSnapshot.toString(),
    additionalKmRateSnapshot: record.additionalKmRateSnapshot.toString(),
    securityDepositSnapshot: record.securityDepositSnapshot.toString(),
    estimatedTotal: record.estimatedTotal.toString(),
    confirmedTotal: record.confirmedTotal?.toString() ?? null,
    customer: canSeeCustomer
      ? {
          ...record.customer,
          id: publicView ? undefined : record.customer.id,
          fullName: customerNameSnapshot,
          mobileNumber: customerMobileSnapshot,
          email: customerEmailSnapshot,
        }
      : null,
    customerNameSnapshot: canSeeCustomer ? customerNameSnapshot : undefined,
    customerMobileSnapshot: canSeeCustomer ? customerMobileSnapshot : undefined,
    customerEmailSnapshot: canSeeCustomer ? customerEmailSnapshot : undefined,
    internalNotes: canSeeInternal ? internalNotes : undefined,
    customerNotes: canSeeCustomer ? customerNotes : undefined,
    vehicle: {
      ...record.vehicle,
      imageUrl: record.vehicle.images[0]
        ? `/api/v1/public/vehicles/${record.vehicle.id}/images/${record.vehicle.images[0].id}`
        : null,
      images: undefined,
    },
    statusHistory: publicView
      ? (record.statusHistory ?? []).map(({ fromStatus, toStatus, occurredAt }) => ({
          fromStatus,
          toStatus,
          occurredAt,
        }))
      : canSeeInternal
        ? record.statusHistory ?? []
        : (record.statusHistory ?? []).map((entry) => omitFields(entry, ['reason', 'actor'])),
    scheduleChanges: publicView
      ? undefined
      : canSeeInternal
        ? record.scheduleChanges
        : record.scheduleChanges?.map((change) => omitFields(change, ['reason', 'changedBy'])),
    handover: canSeeOperations && record.handover
      ? {
          id: record.handover.id,
          handedOverAt: hasPermission(permissions, 'handover.view')
            ? record.handover.handedOverAt
            : undefined,
          startingOdometerKm: hasPermission(permissions, 'handover.view')
            ? record.handover.startingOdometerKm
            : undefined,
          startingFuelPercent: hasPermission(permissions, 'handover.view')
            ? record.handover.startingFuelPercent.toString()
            : undefined,
          returnedAt: hasPermission(permissions, 'returns.view')
            ? record.handover.return?.returnedAt ?? null
            : undefined,
          endingOdometerKm: hasPermission(permissions, 'returns.view')
            ? record.handover.return?.endingOdometerKm ?? null
            : undefined,
          endingFuelPercent: hasPermission(permissions, 'returns.view')
            ? record.handover.return?.endingFuelPercent?.toString() ?? null
            : undefined,
          inspections: record.handover.inspections
            .filter((inspection) => (
              inspection.stage === 'HANDOVER'
                ? hasPermission(permissions, 'handover.view')
                : hasPermission(permissions, 'returns.view')
            ))
            .map((inspection) => ({
            ...inspection,
            damages: inspection.damages,
            })),
        }
      : null,
  };
  if (canSeeFinancials) {
    mapped.charges = charges.map((charge) => ({
      ...charge,
      amount: charge.amount.toString(),
    }));
    mapped.financialSummary = calculateRentalFinancialSummary({
      ...record,
      charges,
      payments,
      depositApplications,
    });
    mapped.payments = !publicView && hasPermission(permissions, 'payments.view')
      ? payments.map((payment) => ({
          id: payment.id,
          direction: payment.direction,
          purpose: payment.purpose,
          status: payment.status,
          method: payment.method,
          amount: payment.amount.toString(),
          currency: payment.currency,
          reference: payment.reference,
          transactionAt: payment.transactionAt,
          allocations: payment.allocations.map((allocation) => ({
            allocationType: allocation.allocationType,
            amount: allocation.amount.toString(),
          })),
        }))
      : undefined;
  } else {
    mapped.estimatedTotal = undefined;
    mapped.confirmedTotal = undefined;
    mapped.rentalPriceSnapshot = undefined;
    mapped.additionalKmRateSnapshot = undefined;
    mapped.securityDepositSnapshot = undefined;
    mapped.charges = undefined;
    mapped.payments = undefined;
    mapped.financialSummary = undefined;
  }
  if (publicView) {
    mapped.createdByStaffId = undefined;
    mapped.confirmedByStaffId = undefined;
    mapped.rejectedByStaffId = undefined;
    mapped.cancelledByStaffId = undefined;
    mapped.rejectionReason = undefined;
    mapped.cancellationReason = undefined;
    mapped.createdBy = undefined;
    mapped.confirmedBy = undefined;
    mapped.internalNotes = undefined;
    mapped.customerNotes = undefined;
    mapped.rentalPolicy = record.rentalPolicy
      ? {
          version: record.rentalPolicy.version,
          rentalTerms: record.rentalPolicy.rentalTerms,
          cancellationTerms: record.rentalPolicy.cancellationTerms,
        }
      : null;
  }
  if (!canSeeInternal) {
    mapped.createdByStaffId = undefined;
    mapped.confirmedByStaffId = undefined;
    mapped.rejectedByStaffId = undefined;
    mapped.cancelledByStaffId = undefined;
    mapped.createdBy = undefined;
    mapped.confirmedBy = undefined;
    mapped.rejectionReason = undefined;
    mapped.cancellationReason = undefined;
  }
  return mapped;
}

function bookingSearchWhere(query, permissions, actor) {
  const and = [];
  if (query.status) and.push({ status: query.status });
  if (query.vehicleId) and.push({ vehicleId: query.vehicleId });
  if (query.customerId) and.push({ customerId: query.customerId });
  if (query.from && query.to) {
    and.push({ pickupAt: { lt: toDate(query.to) }, returnAt: { gt: toDate(query.from) } });
  }
  if (query.search) {
    const searchFields = [
      { reference: { contains: query.search } },
      { registrationSnapshot: { contains: query.search } },
      { vehicle: { specification: { is: { make: { contains: query.search } } } } },
      { vehicle: { specification: { is: { model: { contains: query.search } } } } },
    ];
    if (hasPermission(permissions, 'customers.view')) {
      searchFields.push(
        { customerNameSnapshot: { contains: query.search } },
        { customerMobileSnapshot: { contains: query.search } },
      );
    }
    and.push({
      OR: searchFields,
    });
  }
  if (!hasPermission(permissions, 'bookings.view')) {
    and.push({
      vehicle: {
        staffAssignments: {
          some: {
            staffUserId: actor.id,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        },
      },
    });
  }
  return { AND: and };
}

function transitionFields(toStatus, actor, reason, now) {
  switch (toStatus) {
    case 'CONFIRMED':
      return { confirmedAt: now, confirmedByStaffId: actor.id };
    case 'REJECTED':
      return { rejectedAt: now, rejectedByStaffId: actor.id, rejectionReason: reason };
    case 'CANCELLED':
      return { cancelledAt: now, cancelledByStaffId: actor.id, cancellationReason: reason };
    default:
      return {};
  }
}

function assertTransition(fromStatus, toStatus) {
  if (!allowedTransitions[fromStatus]?.has(toStatus)) {
    throw new AppError(
      409,
      'INVALID_BOOKING_TRANSITION',
      `A booking cannot transition from ${fromStatus} to ${toStatus}.`,
    );
  }
}

export function createBookingService({ prisma, logger, notificationDelivery }) {
  const actionResult = async (booking, actor, permissions) => {
    if (
      hasPermission(permissions, 'bookings.view') ||
      hasPermission(permissions, 'bookings.view.assigned')
    ) {
      return getVisibleBooking(booking.id, actor, permissions);
    }
    return {
      id: booking.id,
      reference: booking.reference,
      status: booking.status,
      pickupAt: booking.pickupAt,
      returnAt: booking.returnAt,
    };
  };

  const safeNotify = async (method, booking, extra = {}) => {
    if (!booking.customerEmailSnapshot || !notificationDelivery?.isConfigured) return;
    try {
      await notificationDelivery[method]({
        email: booking.customerEmailSnapshot,
        reference: booking.reference,
        status: booking.status,
        pickupAt: booking.pickupAt,
        returnAt: booking.returnAt,
        ...extra,
      });
    } catch (error) {
      logger?.warn({
        event: 'booking_notification_delivery_failed',
        reference: booking.reference,
        errorCode: error?.code ?? 'DELIVERY_FAILED',
      });
    }
  };

  const getVisibleBooking = async (id, actor, permissions) => {
    const record = await prisma.booking.findUnique({
      where: { id },
      include: bookingInclude(),
    });
    if (!record) {
      throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking was not found.');
    }
    if (!hasPermission(permissions, 'bookings.view')) {
      await assertAssignedVehicle(prisma, record.vehicleId, actor, permissions);
    }
    return mapBooking(record, permissions);
  };

  async function createBooking({
    input,
    actor,
    permissions,
    auditContext,
    publicRequest = false,
  }) {
    const now = new Date();
    const pickupAt = toDate(input.pickupAt);
    const returnAt = toDate(input.returnAt);
    const initialStatus = publicRequest ? 'PENDING' : input.status;
    if (initialStatus === 'CONFIRMED' && !hasPermission(permissions, 'bookings.confirm')) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to confirm bookings.');
    }
    if (input.adjustments?.length && !hasPermission(permissions, 'bookings.pricing.adjust')) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to adjust booking pricing.');
    }
    const lookupToken = publicRequest ? randomBytes(32).toString('base64url') : null;

    const created = await runTransaction(prisma, async (tx) => {
      await lockVehicle(tx, input.vehicleId);
      if (!publicRequest) {
        await assertAssignedVehicle(tx, input.vehicleId, actor, permissions);
      } else {
        const vehicle = await tx.vehicle.findUnique({
          where: { id: input.vehicleId },
          select: { isPublished: true },
        });
        if (!vehicle?.isPublished) {
          throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
        }
      }
      const policy = await activeRentalPolicy(tx, now);
      validateNewRentalDates(pickupAt, returnAt, now, policy);
      await assertVehicleAvailable(tx, {
        vehicleId: input.vehicleId,
        from: pickupAt,
        to: returnAt,
      });
      const rate = await findRate(tx, {
        vehicleId: input.vehicleId,
        vehicleRateId: input.vehicleRateId,
        rentalPackageId: input.rentalPackageId,
        pickupAt,
      });
      const customer = await createCustomer(
        tx,
        input,
        actor,
        permissions,
        auditContext,
      );
      const adjustments = input.adjustments ?? [];
      let quote;
      try {
        quote = priceQuote({
          rate,
          rentalPackage: rate.rentalPackage,
          pickupAt,
          returnAt,
          adjustments,
        });
      } catch (error) {
        if (error instanceof RangeError) {
          throw new AppError(400, 'INVALID_BOOKING_ADJUSTMENTS', error.message);
        }
        throw error;
      }
      const reference = await allocateBookingReference(tx, now);
      const booking = await tx.booking.create({
        data: {
          referenceYear: reference.year,
          referenceSequence: reference.sequence,
          reference: reference.reference,
          customerId: customer.id,
          vehicleId: input.vehicleId,
          rentalPackageId: rate.rentalPackageId,
          vehicleRateId: rate.id,
          rentalPolicyId: policy?.id ?? null,
          publicLookupTokenHash: lookupToken ? hashLookupToken(lookupToken) : null,
          createdByStaffId: actor?.id ?? null,
          ...(initialStatus === 'CONFIRMED'
            ? { confirmedByStaffId: actor.id, confirmedAt: now }
            : {}),
          source: publicRequest ? 'PUBLIC_WEBSITE' : input.source,
          status: initialStatus,
          pickupAt,
          returnAt,
          rentalDurationUnits: decimal(String(quote.units)),
          packageNameSnapshot: rate.rentalPackage.name,
          rentalPeriodSnapshot: rate.rentalPackage.rentalPeriod,
          durationCountSnapshot: rate.rentalPackage.durationCount,
          packageConditionsSnapshot: rate.rentalPackage.conditions,
          rentalPriceSnapshot: rate.rentalPrice,
          includedMileageKmSnapshot: rate.includedMileageKm,
          additionalKmRateSnapshot: rate.additionalKmRate,
          securityDepositSnapshot: rate.securityDeposit,
          estimatedTotal: decimal(quote.total),
          confirmedTotal: initialStatus === 'CONFIRMED' ? decimal(quote.total) : null,
          rentalPolicyVersionSnapshot: policy?.version ?? null,
          rentalTermsSnapshot: policy?.rentalTerms ?? null,
          currency: rate.currency,
          customerNameSnapshot: customer.fullName,
          customerMobileSnapshot: customer.mobileNumber,
          customerEmailSnapshot: customer.email,
          registrationSnapshot: (await tx.vehicle.findUnique({
            where: { id: input.vehicleId },
            select: { registrationNumber: true },
          })).registrationNumber,
          pickupLocationSnapshot: input.pickupLocation ?? null,
          returnLocationSnapshot: input.returnLocation ?? null,
          customerNotes: input.customerNotes ?? null,
          internalNotes: publicRequest ? null : input.internalNotes ?? null,
          createdAt: now,
        },
      });
      await createQuoteLines(tx, {
        bookingId: booking.id,
        actor,
        currency: rate.currency,
        packageName: rate.rentalPackage.name,
        quote,
        adjustments,
      });
      await tx.bookingStatusHistory.create({
        data: {
          bookingId: booking.id,
          changedByStaffId: actor?.id ?? null,
          fromStatus: null,
          toStatus: initialStatus,
          reason: initialStatus === 'CONFIRMED' ? 'Confirmed at creation.' : null,
          occurredAt: now,
        },
      });
      await writeAudit(tx, {
        ...actorAuditFields(actor),
        action: 'booking.reference_generated',
        entityType: 'Booking',
        entityId: booking.id,
        ...auditContext,
        afterSnapshot: { reference: booking.reference, referenceYear: reference.year },
      });
      await writeAudit(tx, {
        ...actorAuditFields(actor),
        action: 'booking.created',
        entityType: 'Booking',
        entityId: booking.id,
        ...auditContext,
        afterSnapshot: {
          reference: booking.reference,
          status: booking.status,
          vehicleId: booking.vehicleId,
          pickupAt: booking.pickupAt,
          returnAt: booking.returnAt,
          estimatedTotal: booking.estimatedTotal.toString(),
          currency: booking.currency,
          source: booking.source,
        },
      });
      if (initialStatus === 'CONFIRMED') {
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'booking.confirmed',
          entityType: 'Booking',
          entityId: booking.id,
          ...auditContext,
          afterSnapshot: { status: 'CONFIRMED', confirmedTotal: quote.total },
        });
      }
      return {
        id: booking.id,
        reference: booking.reference,
        status: booking.status,
        pickupAt: booking.pickupAt,
        returnAt: booking.returnAt,
        customerEmailSnapshot: booking.customerEmailSnapshot,
        estimatedTotal: booking.estimatedTotal.toString(),
        currency: booking.currency,
      };
    });

    if (publicRequest) {
      await safeNotify('sendRequestReceived', created, { lookupToken });
    } else if (created.status === 'CONFIRMED') {
      await safeNotify('sendStatusChanged', created);
    }
    return {
      ...created,
      lookupToken,
    };
  }

  return {
    async availableVehicles({ query, publicOnly = false, actor, permissions }) {
      const from = toDate(query.pickupAt);
      const to = toDate(query.returnAt);
      const now = new Date();
      if (from <= now || to <= from) {
        throw new AppError(400, 'INVALID_RENTAL_PERIOD', 'Choose a future pickup and a later return.');
      }
      const policy = await prisma.rentalPolicy.findFirst({
        where: {
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      });
      validateNewRentalDates(from, to, now, policy);
      const rateWhere = {
        isActive: true,
        effectiveFrom: { lte: from },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }],
        rentalPackage: { isActive: true },
      };
      const and = [
        { status: 'ACTIVE', archivedAt: null },
        dateAvailabilityWhere(from, to),
        { rates: { some: rateWhere } },
      ];
      if (publicOnly) and.push({ isPublished: true });
      if (query.vehicleId) and.push({ id: query.vehicleId });
      if (query.search) {
        and.push({
          OR: [
            ...(!publicOnly ? [{ registrationNumber: { contains: query.search } }] : []),
            { specification: { is: { make: { contains: query.search } } } },
            { specification: { is: { model: { contains: query.search } } } },
          ],
        });
      }
      if (!publicOnly && !hasPermission(permissions, 'bookings.view')) {
        and.push({
          staffAssignments: {
            some: {
              staffUserId: actor.id,
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
          },
        });
      }
      const where = { AND: and };
      const [items, total] = await prisma.$transaction([
        prisma.vehicle.findMany({
          where,
          include: {
            specification: {
              select: {
                make: true,
                model: true,
                variant: true,
                category: true,
                manufacturingYear: true,
                transmission: true,
                seatingCapacity: true,
              },
            },
            images: {
              where: { archivedAt: null, isPublished: true },
              select: { id: true, caption: true, isPrimary: true },
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
              take: 1,
            },
            rates: {
              where: rateWhere,
              include: {
                rentalPackage: {
                  select: { id: true, code: true, name: true, rentalPeriod: true, durationCount: true, conditions: true },
                },
              },
              orderBy: [{ rentalPackageId: 'asc' }, { effectiveFrom: 'desc' }],
            },
          },
          orderBy: [{ registrationNumber: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.vehicle.count({ where }),
      ]);
      return {
        items: items.map((vehicle) => ({
          id: vehicle.id,
          ...(!publicOnly ? { registrationNumber: vehicle.registrationNumber } : {}),
          specification: vehicle.specification,
          imageUrl: vehicle.images[0]
            ? `/api/v1/public/vehicles/${vehicle.id}/images/${vehicle.images[0].id}`
            : null,
          rates: vehicle.rates.map((rate) => ({
            id: rate.id,
            currency: rate.currency,
            rentalPrice: rate.rentalPrice.toString(),
            includedMileageKm: rate.includedMileageKm,
            additionalKmRate: rate.additionalKmRate.toString(),
            securityDeposit: rate.securityDeposit.toString(),
            package: rate.rentalPackage,
          })),
        })),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          pages: Math.ceil(total / query.limit),
        },
      };
    },

    async createStaffBooking({ input, actor, permissions, auditContext }) {
      return createBooking({ input, actor, permissions, auditContext });
    },

    async createPublicRequest({ input, auditContext }) {
      return createBooking({
        input: {
          ...input,
          customer: {
            fullName: input.fullName,
            mobileNumber: input.mobileNumber,
            email: input.email,
          },
        },
        actor: null,
        permissions: [],
        auditContext,
        publicRequest: true,
      });
    },

    async publicLookup({ reference, token }) {
      const record = await prisma.booking.findUnique({
        where: { reference },
        include: bookingInclude(),
      });
      if (
        !record ||
        !compareHashes(record.publicLookupTokenHash, hashLookupToken(token))
      ) {
        throw new AppError(404, 'BOOKING_LOOKUP_NOT_FOUND', 'No booking was found for those details.');
      }
      const booking = mapBooking(record, ['bookings.pricing.view', 'payments.view', 'customers.view'], {
        publicView: true,
      });
      return {
        reference: booking.reference,
        status: booking.status,
        pickupAt: booking.pickupAt,
        returnAt: booking.returnAt,
        currency: booking.currency,
        estimatedTotal: booking.estimatedTotal,
        confirmedTotal: booking.confirmedTotal,
        vehicle: { specification: booking.vehicle.specification },
        statusHistory: booking.statusHistory,
      };
    },

    async list({ query, actor, permissions }) {
      const where = bookingSearchWhere(query, permissions, actor);
      const orderBy = {
        createdAt: [{ createdAt: query.sortOrder }, { id: query.sortOrder }],
        pickupAt: [{ pickupAt: query.sortOrder }, { id: query.sortOrder }],
        returnAt: [{ returnAt: query.sortOrder }, { id: query.sortOrder }],
        reference: [{ reference: query.sortOrder }, { id: query.sortOrder }],
      }[query.sortBy];
      const [records, total] = await prisma.$transaction([
        prisma.booking.findMany({
          where,
          orderBy,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          include: {
            ...bookingInclude(),
            statusHistory: false,
            scheduleChanges: false,
            handover: false,
            rentalPolicy: false,
          },
        }),
        prisma.booking.count({ where }),
      ]);
      return {
        items: records.map((record) => mapBooking(record, permissions)),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          pages: Math.ceil(total / query.limit),
        },
      };
    },

    async getById({ id, actor, permissions }) {
      return getVisibleBooking(id, actor, permissions);
    },

    async history({ id, actor, permissions }) {
      const record = await getVisibleBooking(id, actor, permissions);
      return record.statusHistory;
    },

    async customerSearch({ search, page, limit }) {
      const where = {
        status: 'ACTIVE',
        archivedAt: null,
        OR: [
          { fullName: { contains: search } },
          { mobileNumber: { contains: search } },
          { email: { contains: search } },
        ],
      };
      const [items, total] = await prisma.$transaction([
        prisma.customer.findMany({
          where,
          select: { id: true, fullName: true, mobileNumber: true, email: true },
          orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.customer.count({ where }),
      ]);
      return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
    },

    async calendar({ query, actor, permissions }) {
      const from = toDate(query.from);
      const to = toDate(query.to);
      const bookingWhere = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
        OR: [
          { pickupAt: { lt: to }, returnAt: { gt: from } },
          {
            status: 'HANDED_OVER',
            OR: [
              { handover: { is: null }, pickupAt: { lt: to } },
              {
                handover: {
                  is: {
                    handedOverAt: { lt: to },
                    return: { is: null },
                  },
                },
              },
            ],
          },
        ],
        ...(!hasPermission(permissions, 'bookings.view')
          ? {
              vehicle: {
                staffAssignments: {
                  some: {
                    staffUserId: actor.id,
                    revokedAt: null,
                    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                  },
                },
              },
            }
          : {}),
      };
      const vehicleScope = !hasPermission(permissions, 'bookings.view')
        ? {
            staffAssignments: {
              some: {
                staffUserId: actor.id,
                revokedAt: null,
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
            },
          }
        : {};
      const [bookings, blocks, maintenanceJobs] = await Promise.all([
        prisma.booking.findMany({
          where: bookingWhere,
          include: {
            vehicle: { select: { id: true, registrationNumber: true, specification: { select: { make: true, model: true } } } },
            handover: {
              select: {
                handedOverAt: true,
                return: { select: { returnedAt: true } },
              },
            },
          },
          orderBy: [{ pickupAt: 'asc' }, { id: 'asc' }],
          take: 501,
        }),
        prisma.vehicleAvailabilityBlock.findMany({
          where: {
            ...blockingAvailabilityBlockWhere(from, to),
            ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
            vehicle: vehicleScope,
          },
          include: {
            vehicle: { select: { id: true, registrationNumber: true, specification: { select: { make: true, model: true } } } },
          },
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          take: 501,
        }),
        prisma.maintenanceJob.findMany({
          where: {
            ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
            ...blockingMaintenanceWhere(from, to),
            vehicle: vehicleScope,
          },
          include: {
            vehicle: { select: { id: true, registrationNumber: true, specification: { select: { make: true, model: true } } } },
          },
          orderBy: [{ scheduledStartAt: 'asc' }, { id: 'asc' }],
          take: 501,
        }),
      ]);
      const bookingEvents = bookings.map((booking) => ({
        id: booking.id,
        type: 'BOOKING',
        reference: booking.reference,
        status: booking.status,
        title: hasPermission(permissions, 'customers.view')
          ? `${booking.reference} · ${booking.customerNameSnapshot}`
          : booking.reference,
        vehicle: booking.vehicle,
        start: booking.status === 'HANDED_OVER'
          ? booking.handover?.handedOverAt ?? booking.pickupAt
          : booking.pickupAt,
        end: booking.status === 'HANDED_OVER'
          ? booking.handover?.return?.returnedAt ?? null
          : booking.returnAt,
        pickupAt: booking.pickupAt,
        returnAt: booking.returnAt,
      }));
      const blockEvents = blocks.map((block) => ({
        id: block.id,
        type: block.reason === 'MAINTENANCE' || block.reason === 'REPAIR' ? 'MAINTENANCE' : 'BLOCK',
        status: block.reason === 'MAINTENANCE' || block.reason === 'REPAIR' ? 'MAINTENANCE' : block.status,
        title: `${block.vehicle.registrationNumber} · ${block.description}`,
        vehicle: block.vehicle,
        start: block.startsAt,
        end: block.endsAt,
      }));
      const maintenanceEvents = maintenanceJobs.map((job) => ({
        id: job.id,
        type: 'MAINTENANCE',
        status: 'MAINTENANCE',
        title: `${job.vehicle.registrationNumber} · ${job.summary}`,
        vehicle: job.vehicle,
        start: job.actualStartAt ?? job.scheduledStartAt ?? from,
        end: job.estimatedCompletionAt,
      }));
      const events = [...bookingEvents, ...blockEvents, ...maintenanceEvents]
        .sort((left, right) => new Date(left.start) - new Date(right.start));
      const truncated = events.length > 500;
      return { items: events.slice(0, 500), truncated };
    },

    async update({ id, input, actor, permissions, auditContext }) {
      const observedVehicleId = await bookingVehicleId(prisma, id);
      const nextVehicleId = input.vehicleId ?? observedVehicleId;
      const result = await runTransaction(prisma, async (tx) => {
        await lockVehicles(tx, [observedVehicleId, nextVehicleId]);
        await tx.$queryRaw`SELECT id FROM Booking WHERE id = ${id} FOR UPDATE`;
        const current = await tx.booking.findUnique({ where: { id } });
        if (!current) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking was not found.');
        if (current.vehicleId !== observedVehicleId) {
          throw new AppError(409, 'BOOKING_CHANGED', 'The booking changed. Reload it and try again.');
        }
        await assertAssignedVehicle(tx, current.vehicleId, actor, permissions);
        await assertAssignedVehicle(tx, nextVehicleId, actor, permissions);
        if (!['PENDING', 'UNDER_REVIEW'].includes(current.status)) {
          throw new AppError(409, 'BOOKING_NOT_EDITABLE', 'Only pending bookings can be edited.');
        }
        const now = new Date();
        const pickupAt = input.pickupAt === undefined ? current.pickupAt : toDate(input.pickupAt);
        const returnAt = input.returnAt === undefined ? current.returnAt : toDate(input.returnAt);
        const policy = await activeRentalPolicy(tx, now);
        validateNewRentalDates(pickupAt, returnAt, now, policy);
        const scheduleChanged =
          nextVehicleId !== current.vehicleId ||
          pickupAt.getTime() !== current.pickupAt.getTime() ||
          returnAt.getTime() !== current.returnAt.getTime() ||
          (input.vehicleRateId !== undefined && input.vehicleRateId !== current.vehicleRateId) ||
          (input.rentalPackageId !== undefined && input.rentalPackageId !== current.rentalPackageId);
        if (scheduleChanged) {
          await assertVehicleAvailable(tx, {
            vehicleId: nextVehicleId,
            from: pickupAt,
            to: returnAt,
            excludeBookingId: id,
          });
        }
        const vehicleRateId = input.vehicleRateId ?? current.vehicleRateId;
        const rentalPackageId = input.rentalPackageId ?? current.rentalPackageId;
        const rate = scheduleChanged
          ? await findRate(tx, {
              vehicleId: nextVehicleId,
              vehicleRateId,
              rentalPackageId,
              pickupAt,
            })
          : null;
        let pricingUpdate = {};
        if (scheduleChanged) {
          const existingAdjustments = await tx.bookingCharge.findMany({
            where: {
              bookingId: id,
              isInitialQuoteLine: true,
              voidedAt: null,
              chargeType: { not: 'RENTAL' },
            },
            select: { amount: true, chargeType: true, direction: true, description: true },
          });
          if (rate.currency !== current.currency) {
            throw new AppError(
              409,
              'BOOKING_CURRENCY_CHANGE_NOT_ALLOWED',
              'A booking cannot be repriced in a different currency.',
            );
          }
          let quote;
          try {
            quote = priceQuote({
              rate,
              rentalPackage: rate.rentalPackage,
              pickupAt,
              returnAt,
              adjustments: existingAdjustments,
            });
          } catch (error) {
            if (error instanceof RangeError) {
              throw new AppError(409, 'INVALID_BOOKING_ADJUSTMENTS', error.message);
            }
            throw error;
          }
          await tx.bookingCharge.updateMany({
            where: { bookingId: id, chargeType: 'RENTAL', isInitialQuoteLine: true, voidedAt: null },
            data: { voidedAt: now, voidReason: 'Booking quote recalculated after schedule change.' },
          });
          await createQuoteLines(tx, {
            bookingId: id,
            actor,
            currency: rate.currency,
            packageName: rate.rentalPackage.name,
            quote,
            adjustments: [],
          });
          pricingUpdate = {
            vehicleRateId: rate.id,
            rentalPackageId: rate.rentalPackageId,
            rentalDurationUnits: decimal(String(quote.units)),
            packageNameSnapshot: rate.rentalPackage.name,
            rentalPeriodSnapshot: rate.rentalPackage.rentalPeriod,
            durationCountSnapshot: rate.rentalPackage.durationCount,
            packageConditionsSnapshot: rate.rentalPackage.conditions,
            rentalPriceSnapshot: rate.rentalPrice,
            includedMileageKmSnapshot: rate.includedMileageKm,
            additionalKmRateSnapshot: rate.additionalKmRate,
            securityDepositSnapshot: rate.securityDeposit,
            estimatedTotal: decimal(quote.total),
            currency: rate.currency,
          };
          if (nextVehicleId !== current.vehicleId) {
            const vehicle = await tx.vehicle.findUnique({
              where: { id: nextVehicleId },
              select: { registrationNumber: true },
            });
            pricingUpdate.registrationSnapshot = vehicle.registrationNumber;
          }
        }
        if (scheduleChanged) {
          await tx.bookingScheduleChange.create({
            data: {
              bookingId: id,
              changedByStaffId: actor.id,
              previousPickupAt: current.pickupAt,
              previousReturnAt: current.returnAt,
              newPickupAt: pickupAt,
              newReturnAt: returnAt,
              reason: input.scheduleChangeReason,
            },
          });
        }
        const updated = await tx.booking.update({
          where: { id },
          data: {
            vehicleId: nextVehicleId,
            pickupAt,
            returnAt,
            ...(input.pickupLocation === undefined ? {} : { pickupLocationSnapshot: input.pickupLocation }),
            ...(input.returnLocation === undefined ? {} : { returnLocationSnapshot: input.returnLocation }),
            ...(input.customerNotes === undefined ? {} : { customerNotes: input.customerNotes }),
            ...(input.internalNotes === undefined ? {} : { internalNotes: input.internalNotes }),
            ...pricingUpdate,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'booking.updated',
          entityType: 'Booking',
          entityId: id,
          ...auditContext,
          beforeSnapshot: {
            vehicleId: current.vehicleId,
            pickupAt: current.pickupAt,
            returnAt: current.returnAt,
            estimatedTotal: current.estimatedTotal.toString(),
          },
          afterSnapshot: {
            vehicleId: updated.vehicleId,
            pickupAt: updated.pickupAt,
            returnAt: updated.returnAt,
            estimatedTotal: updated.estimatedTotal.toString(),
            scheduleChanged,
          },
        });
        return updated;
      });
      return getVisibleBooking(result.id, actor, permissions);
    },

    async confirm({ id, actor, permissions, auditContext }) {
      let updated;
      try {
        const vehicleId = await bookingVehicleId(prisma, id);
        updated = await runTransaction(prisma, async (tx) => {
          const booking = await lockBooking(tx, id, vehicleId);
          await assertAssignedVehicle(tx, booking.vehicleId, actor, permissions);
          assertTransition(booking.status, 'CONFIRMED');
          const now = new Date();
          const policy = await activeRentalPolicy(tx, now);
          validateNewRentalDates(booking.pickupAt, booking.returnAt, now, policy);
          await assertVehicleAvailable(tx, {
            vehicleId: booking.vehicleId,
            from: booking.pickupAt,
            to: booking.returnAt,
            excludeBookingId: id,
          });
          const confirmed = await tx.booking.update({
            where: { id },
            data: {
              status: 'CONFIRMED',
              confirmedAt: now,
              confirmedByStaffId: actor.id,
              confirmedTotal: booking.estimatedTotal,
            },
          });
          await tx.bookingStatusHistory.create({
            data: {
              bookingId: id,
              changedByStaffId: actor.id,
              fromStatus: booking.status,
              toStatus: 'CONFIRMED',
              occurredAt: now,
            },
          });
          await writeAudit(tx, {
            ...actorAuditFields(actor),
            action: 'booking.confirmed',
            entityType: 'Booking',
            entityId: id,
            ...auditContext,
            beforeSnapshot: { status: booking.status },
            afterSnapshot: {
              status: 'CONFIRMED',
              confirmedTotal: booking.estimatedTotal.toString(),
              currency: booking.currency,
            },
          });
          return confirmed;
        });
      } catch (error) {
        if (error?.code === 'BOOKING_AVAILABILITY_CONFLICT') {
          await writeAudit(prisma, {
            ...actorAuditFields(actor),
            action: 'booking.confirmation_conflict',
            entityType: 'Booking',
            entityId: id,
            ...auditContext,
            afterSnapshot: { outcome: 'CONFLICT' },
          });
        }
        throw error;
      }
      await safeNotify('sendStatusChanged', updated);
      return actionResult(updated, actor, permissions);
    },

    async transition({ id, toStatus, reason, actor, permissions, auditContext }) {
      if (['HANDED_OVER', 'RETURNED', 'COMPLETED'].includes(toStatus)) {
        throw new AppError(
          409,
          'RENTAL_OPERATIONS_REQUIRED',
          'Vehicle handover, return, and finalization must use the rental-operations workflow.',
        );
      }
      const vehicleId = await bookingVehicleId(prisma, id);
      const updated = await runTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, id, vehicleId);
        await assertAssignedVehicle(tx, booking.vehicleId, actor, permissions);
        assertTransition(booking.status, toStatus);
        const now = new Date();
        if (toStatus === 'NO_SHOW' && booking.pickupAt > now) {
          throw new AppError(409, 'NO_SHOW_TOO_EARLY', 'A booking cannot be marked no-show before pickup.');
        }
        if (toStatus === 'COMPLETED' && booking.status !== 'RETURNED') {
          throw new AppError(409, 'BOOKING_NOT_RETURNED', 'Only a returned booking can be completed.');
        }
        const changed = await tx.booking.update({
          where: { id },
          data: {
            status: toStatus,
            ...transitionFields(toStatus, actor, reason, now),
          },
        });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId: id,
            changedByStaffId: actor.id,
            fromStatus: booking.status,
            toStatus,
            reason,
            occurredAt: now,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: `booking.${toStatus.toLowerCase()}`,
          entityType: 'Booking',
          entityId: id,
          ...auditContext,
          beforeSnapshot: { status: booking.status },
          afterSnapshot: { status: toStatus, reason: reason ?? null },
        });
        return changed;
      });
      if (['REJECTED', 'CANCELLED'].includes(toStatus)) {
        await safeNotify('sendStatusChanged', updated);
      }
      return actionResult(updated, actor, permissions);
    },

    async handover({ id, input, actor, permissions, auditContext }) {
      const vehicleId = await bookingVehicleId(prisma, id);
      const updated = await runTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, id, vehicleId);
        await assertAssignedVehicle(tx, booking.vehicleId, actor, permissions);
        assertTransition(booking.status, 'HANDED_OVER');
        const now = new Date();
        const handedOverAt = input.handedOverAt ? toDate(input.handedOverAt) : now;
        if (handedOverAt > now) {
          throw new AppError(400, 'HANDOVER_CANNOT_BE_FUTURE', 'Handover time cannot be in the future.');
        }
        const vehicle = await tx.vehicle.findUnique({
          where: { id: booking.vehicleId },
          select: { currentOdometerKm: true },
        });
        if (
          vehicle.currentOdometerKm != null &&
          input.startingOdometerKm < vehicle.currentOdometerKm
        ) {
          throw new AppError(409, 'MILEAGE_CANNOT_DECREASE', 'Handover mileage cannot be below the current odometer.');
        }
        const handover = await tx.rentalHandover.create({
          data: {
            bookingId: id,
            staffUserId: actor.id,
            handedOverAt,
            startingOdometerKm: input.startingOdometerKm,
            startingFuelPercent: decimal(input.startingFuelPercent),
          },
        });
        await tx.rentalInspection.create({
          data: {
            handoverId: handover.id,
            inspectedByStaffId: actor.id,
            stage: 'HANDOVER',
            inspectedAt: handedOverAt,
            conditionSummary: input.conditionSummary ?? null,
          },
        });
        await tx.vehicle.update({
          where: { id: booking.vehicleId },
          data: { currentOdometerKm: input.startingOdometerKm },
        });
        await tx.vehicleMileageReading.create({
          data: {
            vehicleId: booking.vehicleId,
            recordedByStaffId: actor.id,
            readingKm: input.startingOdometerKm,
            previousOdometerKm: vehicle.currentOdometerKm,
            source: 'MANUAL',
            reason: `Rental handover ${booking.reference}`,
            recordedAt: handedOverAt,
          },
        });
        await tx.booking.update({
          where: { id },
          data: { status: 'HANDED_OVER' },
        });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId: id,
            changedByStaffId: actor.id,
            fromStatus: 'CONFIRMED',
            toStatus: 'HANDED_OVER',
            occurredAt: handedOverAt,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'booking.handed_over',
          entityType: 'Booking',
          entityId: id,
          ...auditContext,
          afterSnapshot: {
            status: 'HANDED_OVER',
            handoverId: handover.id,
            handedOverAt,
            startingOdometerKm: input.startingOdometerKm,
          },
        });
        return { ...booking, status: 'HANDED_OVER' };
      });
      await safeNotify('sendStatusChanged', updated);
      return getVisibleBooking(id, actor, permissions);
    },

    async returnVehicle({ id, input, actor, permissions, auditContext }) {
      const vehicleId = await bookingVehicleId(prisma, id);
      const updated = await runTransaction(prisma, async (tx) => {
        const booking = await lockBooking(tx, id, vehicleId);
        await assertAssignedVehicle(tx, booking.vehicleId, actor, permissions);
        assertTransition(booking.status, 'RETURNED');
        const now = new Date();
        const returnedAt = input.returnedAt ? toDate(input.returnedAt) : now;
        if (returnedAt > now) {
          throw new AppError(400, 'RETURN_CANNOT_BE_FUTURE', 'Return time cannot be in the future.');
        }
        const handover = await tx.rentalHandover.findUnique({
          where: { bookingId: id },
          select: { id: true, handedOverAt: true, startingOdometerKm: true },
        });
        if (!handover) {
          throw new AppError(409, 'HANDOVER_REQUIRED', 'Record vehicle handover before recording a return.');
        }
        if (returnedAt < handover.handedOverAt) {
          throw new AppError(400, 'INVALID_RETURN_TIME', 'Return time must follow the handover time.');
        }
        if (input.endingOdometerKm < handover.startingOdometerKm) {
          throw new AppError(409, 'MILEAGE_CANNOT_DECREASE', 'Return mileage cannot be below handover mileage.');
        }
        const vehicle = await tx.vehicle.findUnique({
          where: { id: booking.vehicleId },
          select: { currentOdometerKm: true },
        });
        if (
          vehicle.currentOdometerKm != null &&
          input.endingOdometerKm < vehicle.currentOdometerKm
        ) {
          throw new AppError(409, 'MILEAGE_CANNOT_DECREASE', 'Return mileage cannot be below the current odometer.');
        }
        const rentalReturn = await tx.rentalReturn.create({
          data: {
            handoverId: handover.id,
            staffUserId: actor.id,
            returnedAt,
            endingOdometerKm: input.endingOdometerKm,
            endingFuelPercent: decimal(input.endingFuelPercent),
          },
        });
        await tx.rentalInspection.create({
          data: {
            rentalReturnId: rentalReturn.id,
            inspectedByStaffId: actor.id,
            stage: 'RETURN',
            inspectedAt: returnedAt,
            conditionSummary: input.conditionSummary ?? null,
          },
        });
        await tx.vehicle.update({
          where: { id: booking.vehicleId },
          data: { currentOdometerKm: input.endingOdometerKm },
        });
        await tx.vehicleMileageReading.create({
          data: {
            vehicleId: booking.vehicleId,
            recordedByStaffId: actor.id,
            readingKm: input.endingOdometerKm,
            previousOdometerKm: vehicle.currentOdometerKm,
            source: 'MANUAL',
            reason: `Rental return ${booking.reference}`,
            recordedAt: returnedAt,
          },
        });
        await tx.booking.update({
          where: { id },
          data: { status: 'RETURNED' },
        });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId: id,
            changedByStaffId: actor.id,
            fromStatus: 'HANDED_OVER',
            toStatus: 'RETURNED',
            reason: 'Vehicle returned.',
            occurredAt: returnedAt,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'booking.returned',
          entityType: 'Booking',
          entityId: id,
          ...auditContext,
          afterSnapshot: {
            status: 'RETURNED',
            returnId: rentalReturn.id,
            returnedAt,
            endingOdometerKm: input.endingOdometerKm,
          },
        });
        return { ...booking, status: 'RETURNED' };
      });
      await safeNotify('sendStatusChanged', updated);
      return getVisibleBooking(id, actor, permissions);
    },
  };
}
