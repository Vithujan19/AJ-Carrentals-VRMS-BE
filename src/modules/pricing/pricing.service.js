import { writeAudit } from '../../shared/audit.js';
import { AppError } from '../../shared/errors.js';

const RATE_TRANSACTION_OPTIONS = { timeout: 30_000 };

function actorAuditFields(actor) {
  return {
    actorStaffUserId: actor.id,
    actorIdentifierSnapshot: actor.email,
  };
}

function mapRate(rate) {
  return {
    ...rate,
    rentalPrice: rate.rentalPrice.toString(),
    additionalKmRate: rate.additionalKmRate.toString(),
    securityDeposit: rate.securityDeposit.toString(),
  };
}

function mapDate(value) {
  return value == null ? value : new Date(value);
}

async function getActiveVehicle(tx, id) {
  const vehicle = await tx.vehicle.findUnique({
    where: { id },
    select: { id: true, status: true, archivedAt: true },
  });
  if (!vehicle) {
    throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
  }
  if (vehicle.archivedAt) {
    throw new AppError(409, 'VEHICLE_ARCHIVED', 'Archived vehicle rates cannot be changed.');
  }
  return vehicle;
}

async function assertNoOverlap(tx, { vehicleId, rentalPackageId, effectiveFrom, effectiveTo, excludeId }) {
  const conflict = await tx.vehicleRate.findFirst({
    where: {
      vehicleId,
      rentalPackageId,
      isActive: true,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      ...(effectiveTo ? { effectiveFrom: { lt: effectiveTo } } : {}),
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
    },
    select: { id: true },
  });
  if (conflict) {
    throw new AppError(
      409,
      'VEHICLE_RATE_PERIOD_OVERLAP',
      'An active rate already covers part of that period for this package.',
    );
  }
}

function translateUniqueError(error, code, message) {
  if (error?.code === 'P2002') {
    throw new AppError(409, code, message);
  }
  throw error;
}

export function createPricingService({ prisma }) {
  return {
    async listPackages(includeInactive) {
      return prisma.rentalPackage.findMany({
        where: includeInactive ? {} : { isActive: true },
        orderBy: [{ rentalPeriod: 'asc' }, { durationCount: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          rentalPeriod: true,
          durationCount: true,
          conditions: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    },

    async createPackage({ input, actor, auditContext }) {
      try {
        return await prisma.$transaction(async (tx) => {
          const rentalPackage = await tx.rentalPackage.create({
            data: {
              ...input,
              code: input.code.toUpperCase(),
            },
          });
          await writeAudit(tx, {
            ...actorAuditFields(actor),
            action: 'rental_package.created',
            entityType: 'RentalPackage',
            entityId: rentalPackage.id,
            ...auditContext,
            afterSnapshot: {
              code: rentalPackage.code,
              name: rentalPackage.name,
              rentalPeriod: rentalPackage.rentalPeriod,
              durationCount: rentalPackage.durationCount,
            },
          });
          return rentalPackage;
        });
      } catch (error) {
        translateUniqueError(error, 'DUPLICATE_RENTAL_PACKAGE_CODE', 'A rental package with that code already exists.');
      }
    },

    async updatePackage({ packageId, input, actor, auditContext }) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM RentalPackage WHERE id = ${packageId} FOR UPDATE`;
        const current = await tx.rentalPackage.findUnique({ where: { id: packageId } });
        if (!current) {
          throw new AppError(404, 'RENTAL_PACKAGE_NOT_FOUND', 'Rental package was not found.');
        }
        const updated = await tx.rentalPackage.update({ where: { id: packageId }, data: input });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'rental_package.updated',
          entityType: 'RentalPackage',
          entityId: packageId,
          ...auditContext,
          beforeSnapshot: {
            name: current.name,
            conditions: current.conditions,
            isActive: current.isActive,
          },
          afterSnapshot: {
            name: updated.name,
            conditions: updated.conditions,
            isActive: updated.isActive,
          },
        });
        return updated;
      });
    },

    async listRates(vehicleId, includeInactive) {
      const vehicle = await prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: { id: true, archivedAt: true },
      });
      if (!vehicle) {
        throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
      }
      const rates = await prisma.vehicleRate.findMany({
        where: {
          vehicleId,
          ...(includeInactive ? {} : { isActive: true }),
        },
        include: {
          rentalPackage: {
            select: { id: true, code: true, name: true, rentalPeriod: true, durationCount: true, isActive: true },
          },
        },
        orderBy: [{ rentalPackageId: 'asc' }, { effectiveFrom: 'desc' }],
      });
      return rates.map(mapRate);
    },

    async createRate({ vehicleId, input, actor, auditContext }) {
      const effectiveFrom = mapDate(input.effectiveFrom);
      const effectiveTo = mapDate(input.effectiveTo);
      if (effectiveFrom <= new Date()) {
        throw new AppError(
          400,
          'RATE_START_MUST_BE_FUTURE',
          'New rates must start in the future; existing rates are retained for past bookings.',
        );
      }
      try {
        return await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM Vehicle WHERE id = ${vehicleId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM RentalPackage WHERE id = ${input.rentalPackageId} FOR UPDATE`;
          const vehicle = await getActiveVehicle(tx, vehicleId);
          if (vehicle.status !== 'ACTIVE') {
            throw new AppError(409, 'VEHICLE_NOT_RENTABLE', 'Rates can only be created for active vehicles.');
          }
          const rentalPackage = await tx.rentalPackage.findUnique({
            where: { id: input.rentalPackageId },
            select: { id: true, isActive: true },
          });
          if (!rentalPackage || !rentalPackage.isActive) {
            throw new AppError(400, 'INVALID_RENTAL_PACKAGE', 'Select an active rental package.');
          }
          await assertNoOverlap(tx, {
            vehicleId,
            rentalPackageId: input.rentalPackageId,
            effectiveFrom,
            effectiveTo,
          });
          const rate = await tx.vehicleRate.create({
            data: {
              ...input,
              vehicleId,
              effectiveFrom,
              effectiveTo,
            },
            include: { rentalPackage: { select: { id: true, code: true, name: true } } },
          });
          await writeAudit(tx, {
            ...actorAuditFields(actor),
            action: 'vehicle.rate_created',
            entityType: 'Vehicle',
            entityId: vehicleId,
            ...auditContext,
            afterSnapshot: { rateId: rate.id, ...mapRate(rate) },
          });
          return mapRate(rate);
        }, RATE_TRANSACTION_OPTIONS);
      } catch (error) {
        translateUniqueError(error, 'DUPLICATE_VEHICLE_RATE', 'An equivalent vehicle rate already exists.');
      }
    },

    async updateRate({ vehicleId, rateId, input, actor, auditContext }) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM Vehicle WHERE id = ${vehicleId} FOR UPDATE`;
        const vehicle = await getActiveVehicle(tx, vehicleId);
        const current = await tx.vehicleRate.findFirst({
          where: { id: rateId, vehicleId },
          include: { rentalPackage: { select: { id: true, code: true, name: true } } },
        });
        if (!current) {
          throw new AppError(404, 'VEHICLE_RATE_NOT_FOUND', 'Vehicle rate was not found.');
        }
        if (vehicle.status !== 'ACTIVE' && input.isActive !== false) {
          throw new AppError(409, 'VEHICLE_NOT_RENTABLE', 'Only rates for active vehicles can be changed or reactivated.');
        }
        if (current.effectiveFrom <= new Date() && Object.keys(input).some((key) => key !== 'isActive')) {
          throw new AppError(
            409,
            'EFFECTIVE_RATE_IS_IMMUTABLE',
            'Rates that have already taken effect cannot be edited; create a future rate instead.',
          );
        }
        const effectiveFrom =
          input.effectiveFrom === undefined ? current.effectiveFrom : mapDate(input.effectiveFrom);
        const effectiveTo =
          input.effectiveTo === undefined
            ? current.effectiveTo
            : input.effectiveTo === null
              ? null
              : mapDate(input.effectiveTo);
        if (effectiveTo && effectiveTo <= effectiveFrom) {
          throw new AppError(400, 'INVALID_RATE_PERIOD', 'Rate end must be after its start.');
        }
        if (
          Object.keys(input).some((key) => key !== 'isActive') &&
          effectiveFrom <= new Date()
        ) {
          throw new AppError(
            400,
            'RATE_START_MUST_BE_FUTURE',
            'Rate edits must remain effective in the future.',
          );
        }
        if (input.isActive === true || (input.isActive === undefined && current.isActive)) {
          await assertNoOverlap(tx, {
            vehicleId,
            rentalPackageId: current.rentalPackageId,
            effectiveFrom,
            effectiveTo,
            excludeId: rateId,
          });
        }
        const updated = await tx.vehicleRate.update({
          where: { id: rateId },
          data: {
            ...input,
            ...(input.effectiveFrom === undefined ? {} : { effectiveFrom }),
            ...(input.effectiveTo === undefined ? {} : { effectiveTo }),
          },
          include: { rentalPackage: { select: { id: true, code: true, name: true } } },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'vehicle.rate_updated',
          entityType: 'Vehicle',
          entityId: vehicleId,
          ...auditContext,
          beforeSnapshot: { rateId, ...mapRate(current) },
          afterSnapshot: { rateId, ...mapRate(updated) },
        });
        return mapRate(updated);
      }, RATE_TRANSACTION_OPTIONS);
    },
  };
}
