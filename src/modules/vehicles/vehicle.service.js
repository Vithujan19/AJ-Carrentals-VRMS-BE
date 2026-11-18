import { writeAudit } from '../../shared/audit.js';
import { AppError } from '../../shared/errors.js';
import { dateAvailabilityWhere } from '../../shared/vehicle-availability.js';

const publicImageFields = {
  id: true,
  mimeType: true,
  sizeBytes: true,
  caption: true,
  sortOrder: true,
  isPrimary: true,
  isPublished: true,
  createdAt: true,
};

function actorAuditFields(actor) {
  return {
    actorStaffUserId: actor.id,
    actorIdentifierSnapshot: actor.email,
  };
}

function vehicleAuditSnapshot(vehicle) {
  if (!vehicle) {
    return null;
  }
  return {
    id: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    status: vehicle.status,
    isPublished: vehicle.isPublished,
    publishedAt: vehicle.publishedAt,
    archivedAt: vehicle.archivedAt,
    currentOdometerKm: vehicle.currentOdometerKm,
    specification: vehicle.specification
      ? {
          make: vehicle.specification.make,
          model: vehicle.specification.model,
          category: vehicle.specification.category,
        }
      : null,
  };
}

function mapDateOnly(value) {
  return value == null ? value : new Date(`${value}T00:00:00.000Z`);
}

function stateFilter(status, now) {
  switch (status) {
    case 'AVAILABLE':
      return {
        status: 'ACTIVE',
        archivedAt: null,
        availabilityBlocks: {
          none: {
            status: 'ACTIVE',
            startsAt: { lte: now },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
        },
        bookings: {
          none: {
            OR: [
              { status: 'HANDED_OVER' },
              {
                status: 'CONFIRMED',
                pickupAt: { lte: now },
                returnAt: { gt: now },
              },
            ],
          },
        },
        maintenanceJobs: {
          none: {
            OR: [
              { status: 'IN_PROGRESS' },
              {
                status: 'SCHEDULED',
                scheduledStartAt: { lte: now },
                OR: [{ estimatedCompletionAt: null }, { estimatedCompletionAt: { gt: now } }],
              },
            ],
          },
        },
      };
    case 'RESERVED':
      return {
        status: 'ACTIVE',
        archivedAt: null,
        AND: [
          {
            bookings: {
              some: {
                status: 'CONFIRMED',
                pickupAt: { lte: now },
                returnAt: { gt: now },
              },
            },
          },
          { bookings: { none: { status: 'HANDED_OVER' } } },
          {
            availabilityBlocks: {
              none: {
                status: 'ACTIVE',
                startsAt: { lte: now },
                OR: [{ endsAt: null }, { endsAt: { gt: now } }],
              },
            },
          },
          {
            maintenanceJobs: {
              none: {
                OR: [
                  { status: 'IN_PROGRESS' },
                  {
                    status: 'SCHEDULED',
                    scheduledStartAt: { lte: now },
                    OR: [{ estimatedCompletionAt: null }, { estimatedCompletionAt: { gt: now } }],
                  },
                ],
              },
            },
          },
        ],
      };
    case 'RENTED':
      return {
        status: 'ACTIVE',
        archivedAt: null,
        bookings: { some: { status: 'HANDED_OVER' } },
        availabilityBlocks: {
          none: {
            status: 'ACTIVE',
            startsAt: { lte: now },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
        },
        maintenanceJobs: {
          none: {
            OR: [
              { status: 'IN_PROGRESS' },
              {
                status: 'SCHEDULED',
                scheduledStartAt: { lte: now },
                OR: [{ estimatedCompletionAt: null }, { estimatedCompletionAt: { gt: now } }],
              },
            ],
          },
        },
      };
    case 'MAINTENANCE':
      return {
        status: 'ACTIVE',
        archivedAt: null,
        OR: [
          {
            availabilityBlocks: {
              some: {
                status: 'ACTIVE',
                startsAt: { lte: now },
                OR: [{ endsAt: null }, { endsAt: { gt: now } }],
              },
            },
          },
          {
            maintenanceJobs: {
              some: {
                OR: [
                  { status: 'IN_PROGRESS' },
                  {
                    status: 'SCHEDULED',
                    scheduledStartAt: { lte: now },
                    OR: [{ estimatedCompletionAt: null }, { estimatedCompletionAt: { gt: now } }],
                  },
                ],
              },
            },
          },
        ],
      };
    case 'INACTIVE':
      return {
        OR: [{ status: { not: 'ACTIVE' } }, { archivedAt: { not: null } }],
      };
    default:
      return {};
  }
}

function operationalStatus(vehicle, now) {
  if (vehicle.archivedAt || vehicle.status !== 'ACTIVE') {
    return 'INACTIVE';
  }
  if (
    vehicle.availabilityBlocks?.some(
      (block) =>
        block.status === 'ACTIVE' &&
        block.startsAt <= now &&
        (!block.endsAt || block.endsAt > now),
    ) ||
    vehicle.maintenanceJobs?.some(
      (job) =>
        job.status === 'IN_PROGRESS' ||
        (job.status === 'SCHEDULED' &&
          job.scheduledStartAt &&
          job.scheduledStartAt <= now &&
          (!job.estimatedCompletionAt || job.estimatedCompletionAt > now)),
    )
  ) {
    return 'MAINTENANCE';
  }
  if (vehicle.bookings?.some((booking) => booking.status === 'HANDED_OVER')) {
    return 'RENTED';
  }
  if (
    vehicle.bookings?.some(
      (booking) =>
        booking.status === 'CONFIRMED' &&
        booking.pickupAt <= now &&
        booking.returnAt > now,
    )
  ) {
    return 'RESERVED';
  }
  return 'AVAILABLE';
}

function vehicleSummary(vehicle, now, includePricing) {
  return {
    id: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    vin: vehicle.vin,
    acquisitionDate: vehicle.acquisitionDate,
    currentOdometerKm: vehicle.currentOdometerKm,
    description: vehicle.description,
    publicDescription: vehicle.publicDescription,
    isPublished: vehicle.isPublished,
    publishedAt: vehicle.publishedAt,
    status: vehicle.status,
    archivedAt: vehicle.archivedAt,
    operationalStatus: operationalStatus(vehicle, now),
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
    specification: vehicle.specification,
    images: (vehicle.images ?? []).map((image) => ({
      ...image,
      sizeBytes: image.sizeBytes.toString(),
      publicUrl: image.isPublished
        ? `/api/v1/public/vehicles/${vehicle.id}/images/${image.id}`
        : null,
      contentUrl: `/api/v1/vehicles/${vehicle.id}/images/${image.id}/content`,
    })),
    ...(includePricing
      ? {
          rates: (vehicle.rates ?? []).map((rate) => ({
            id: rate.id,
            rentalPackageId: rate.rentalPackageId,
            package: rate.rentalPackage,
            rentalPrice: rate.rentalPrice.toString(),
            currency: rate.currency,
            includedMileageKm: rate.includedMileageKm,
            additionalKmRate: rate.additionalKmRate.toString(),
            securityDeposit: rate.securityDeposit.toString(),
            effectiveFrom: rate.effectiveFrom,
            effectiveTo: rate.effectiveTo,
          })),
        }
      : {}),
    documentExpiry: (vehicle.documents ?? []).map((document) => ({
      id: document.id,
      documentType: document.documentType,
      expiresAt: document.expiresAt,
    })),
    maintenance: {
      jobs: (vehicle.maintenanceJobs ?? []).map((job) => ({
        id: job.id,
        status: job.status,
        summary: job.summary,
        scheduledStartAt: job.scheduledStartAt,
        estimatedCompletionAt: job.estimatedCompletionAt,
        nextServiceAt: job.nextServiceAt,
        nextServiceOdometerKm: job.nextServiceOdometerKm,
      })),
      schedules: (vehicle.maintenanceSchedules ?? []).map((schedule) => ({
        id: schedule.id,
        dueAt: schedule.dueAt,
        dueAtOdometerKm: schedule.dueAtOdometerKm,
        status: schedule.status,
        category: schedule.category,
      })),
    },
  };
}

function buildListWhere(
  query,
  actor,
  now,
  canViewAll,
  canViewPricing,
  warningDays,
  overdueMileageVehicleIds,
) {
  const and = [];
  if (query.status) {
    and.push(stateFilter(query.status, now));
  } else {
    and.push({ archivedAt: null });
  }
  if (!canViewAll) {
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
  if (query.lifecycleStatus) {
    and.push({ status: query.lifecycleStatus });
  }
  if (query.category || query.make || query.model || query.fuelType || query.transmission) {
    and.push({
      specification: {
        is: {
          ...(query.category ? { category: query.category } : {}),
          ...(query.make ? { make: { contains: query.make } } : {}),
          ...(query.model ? { model: { contains: query.model } } : {}),
          ...(query.fuelType ? { fuelType: query.fuelType } : {}),
          ...(query.transmission ? { transmission: query.transmission } : {}),
        },
      },
    });
  }
  if (query.yearFrom !== undefined || query.yearTo !== undefined) {
    and.push({
      specification: {
        is: {
          manufacturingYear: {
            ...(query.yearFrom === undefined ? {} : { gte: query.yearFrom }),
            ...(query.yearTo === undefined ? {} : { lte: query.yearTo }),
          },
        },
      },
    });
  }
  if (query.seatingCapacity !== undefined) {
    and.push({ specification: { is: { seatingCapacity: query.seatingCapacity } } });
  }
  if (query.search) {
    and.push({
      OR: [
        { registrationNumber: { contains: query.search } },
        { vin: { contains: query.search } },
        { specification: { is: { make: { contains: query.search } } } },
        { specification: { is: { model: { contains: query.search } } } },
      ],
    });
  }
  if (query.availableFrom && query.availableTo) {
    and.push(
      { status: 'ACTIVE', archivedAt: null },
      dateAvailabilityWhere(new Date(query.availableFrom), new Date(query.availableTo)),
    );
  }
  if (query.priceFrom !== undefined || query.priceTo !== undefined) {
    if (!canViewPricing) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to filter by rental price.');
    }
    and.push({
      rates: {
        some: {
          isActive: true,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          rentalPackage: { isActive: true },
          rentalPrice: {
            ...(query.priceFrom === undefined ? {} : { gte: query.priceFrom }),
            ...(query.priceTo === undefined ? {} : { lte: query.priceTo }),
          },
        },
      },
    });
  }
  if (query.documentExpiry === 'expired') {
    and.push({
      documents: {
        some: { archivedAt: null, expiresAt: { lt: new Date(now.toISOString().slice(0, 10)) } },
      },
    });
  } else if (query.documentExpiry === 'expiring') {
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const warningEnd = new Date(today);
    warningEnd.setUTCDate(warningEnd.getUTCDate() + warningDays);
    and.push({
      documents: {
        some: {
          archivedAt: null,
          expiresAt: { gte: today, lte: warningEnd },
        },
      },
    });
  } else if (query.documentExpiry === 'missing') {
    for (const documentType of ['INSURANCE', 'REVENUE_LICENSE', 'EMISSION_CERTIFICATE']) {
      and.push({
        documents: { none: { archivedAt: null, documentType } },
      });
    }
  }
  if (query.maintenance === 'in_progress') {
    and.push({ maintenanceJobs: { some: { status: 'IN_PROGRESS' } } });
  } else if (query.maintenance === 'overdue') {
    const overdueConditions = [
      { maintenanceSchedules: { some: { status: 'ACTIVE', dueAt: { lte: now } } } },
      { maintenanceJobs: { some: { status: 'COMPLETED', nextServiceAt: { lte: now } } } },
    ];
    if (overdueMileageVehicleIds.length) {
      overdueConditions.push({ id: { in: overdueMileageVehicleIds } });
    }
    and.push({
      OR: overdueConditions,
    });
  } else if (query.maintenance === 'due') {
    const dueEnd = new Date(now);
    dueEnd.setUTCDate(dueEnd.getUTCDate() + warningDays);
    and.push({
      OR: [
        {
          maintenanceSchedules: {
            some: { status: 'ACTIVE', dueAt: { gt: now, lte: dueEnd } },
          },
        },
        {
          maintenanceJobs: {
            some: { status: 'COMPLETED', nextServiceAt: { gt: now, lte: dueEnd } },
          },
        },
      ],
    });
  }

  const searchOrderBy = {
    registration: [{ registrationNumber: query.sortOrder }, { id: 'asc' }],
    makeModel: [
      { specification: { make: query.sortOrder } },
      { specification: { model: query.sortOrder } },
      { id: 'asc' },
    ],
    year: [{ specification: { manufacturingYear: query.sortOrder } }, { id: 'asc' }],
    mileage: [{ currentOdometerKm: query.sortOrder }, { id: 'asc' }],
    createdAt: [{ createdAt: query.sortOrder }, { id: 'asc' }],
  };

  return {
    where: { AND: and },
    orderBy: searchOrderBy[query.sortBy],
  };
}

function vehicleInclude(now, canViewPricing) {
  return {
    specification: true,
    images: {
      where: { archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: publicImageFields,
    },
    documents: {
      where: { archivedAt: null },
      select: { id: true, documentType: true, expiresAt: true },
    },
    availabilityBlocks: {
      where: {
        status: 'ACTIVE',
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { status: true, reason: true, startsAt: true, endsAt: true },
    },
    bookings: {
      where: {
        OR: [
          { status: 'HANDED_OVER' },
          { status: 'CONFIRMED', pickupAt: { lte: now }, returnAt: { gt: now } },
        ],
      },
      select: { status: true, pickupAt: true, returnAt: true },
    },
    maintenanceJobs: {
      where: { status: { in: ['IN_PROGRESS', 'SCHEDULED'] } },
      orderBy: { updatedAt: 'desc' },
    },
    maintenanceSchedules: {
      where: { status: 'ACTIVE' },
      include: { category: { select: { name: true } } },
      orderBy: { dueAt: 'asc' },
      take: 10,
    },
    ...(canViewPricing
      ? {
          rates: {
            where: {
              isActive: true,
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
              rentalPackage: { isActive: true },
            },
            include: {
              rentalPackage: {
                select: { id: true, code: true, name: true, rentalPeriod: true, durationCount: true },
              },
            },
            orderBy: [{ rentalPackageId: 'asc' }, { effectiveFrom: 'desc' }],
          },
        }
      : {}),
  };
}

async function ensureAssignedVehicle(prisma, id, actor, permissions) {
  if (permissions.includes('vehicles.view')) {
    return;
  }
  if (!permissions.includes('vehicles.view.assigned')) {
    throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to view vehicles.');
  }
  const assignment = await prisma.vehicleStaffAssignment.findFirst({
    where: {
      vehicleId: id,
      staffUserId: actor.id,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (!assignment) {
    throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
  }
}

async function getActiveVehicle(tx, id) {
  const vehicle = await tx.vehicle.findUnique({ where: { id } });
  if (!vehicle) {
    throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
  }
  if (vehicle.archivedAt) {
    throw new AppError(409, 'VEHICLE_ARCHIVED', 'Archived vehicles cannot be changed.');
  }
  return vehicle;
}

function translateVehicleUniqueError(error) {
  if (error?.code === 'P2002') {
    throw new AppError(
      409,
      'VEHICLE_IDENTIFIER_IN_USE',
      'A vehicle with one of those identifiers already exists.',
    );
  }
  throw error;
}

function publicationData(isPublished, vehicle) {
  if (isPublished && vehicle.status !== 'ACTIVE') {
    throw new AppError(
      409,
      'VEHICLE_NOT_ACTIVE',
      'Only active vehicles can be published on the public website.',
    );
  }
  return { isPublished, publishedAt: isPublished ? new Date() : null };
}

const PUBLIC_SORTS = {
  newest: [{ updatedAt: 'desc' }, { id: 'asc' }],
  name: [{ specification: { make: 'asc' } }, { specification: { model: 'asc' } }, { id: 'asc' }],
  year_desc: [{ specification: { manufacturingYear: 'desc' } }, { id: 'asc' }],
};

function publicVehicleSelect(now) {
  return {
    id: true,
    publicDescription: true,
    specification: {
      select: {
        make: true, model: true, variant: true, category: true, manufacturingYear: true,
        fuelType: true, transmission: true, seatingCapacity: true, numberOfDoors: true,
        hasAirConditioning: true, features: true,
      },
    },
    images: {
      where: { archivedAt: null, isPublished: true },
      select: { id: true, caption: true },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    },
    rates: {
      where: {
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        rentalPackage: { isActive: true },
      },
      select: {
        id: true, currency: true, rentalPrice: true, includedMileageKm: true,
        additionalKmRate: true, securityDeposit: true,
        rentalPackage: {
          select: { id: true, name: true, rentalPeriod: true, durationCount: true, conditions: true },
        },
      },
      orderBy: [{ rentalPrice: 'asc' }, { id: 'asc' }],
    },
  };
}

function publicVehicle(vehicle) {
  return {
    id: vehicle.id,
    description: vehicle.publicDescription,
    specification: vehicle.specification,
    images: vehicle.images.map((image) => ({
      id: image.id,
      caption: image.caption,
      url: `/api/v1/public/vehicles/${vehicle.id}/images/${image.id}`,
    })),
    rates: vehicle.rates.map((rate) => ({
      id: rate.id,
      currency: rate.currency,
      rentalPrice: rate.rentalPrice.toString(),
      includedMileageKm: rate.includedMileageKm,
      additionalKmRate: rate.additionalKmRate.toString(),
      securityDeposit: rate.securityDeposit.toString(),
      package: rate.rentalPackage,
    })),
  };
}

export function createVehicleService({ prisma, config, storage }) {
  return {
    async publicList({ query }) {
      const { page, limit, search, category, fuelType, transmission, seatingCapacity, maxPrice, sort = 'newest' } = query;
      const where = {
        isPublished: true,
        status: 'ACTIVE',
        archivedAt: null,
        ...(maxPrice !== undefined ? {
          rates: {
            some: {
              isActive: true,
              rentalPrice: { lte: maxPrice },
              effectiveFrom: { lte: new Date() },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
              rentalPackage: { isActive: true },
            },
          },
        } : {}),
        ...((category || fuelType || transmission || seatingCapacity || search) ? {
          specification: {
            is: {
              ...(category ? { category } : {}),
              ...(fuelType ? { fuelType } : {}),
              ...(transmission ? { transmission } : {}),
              ...(seatingCapacity ? { seatingCapacity: { gte: seatingCapacity } } : {}),
              ...(search ? {
                OR: [{ make: { contains: search } }, { model: { contains: search } }],
              } : {}),
            },
          },
        } : {}),
      };
      const [items, total] = await prisma.$transaction([
        prisma.vehicle.findMany({
          where,
          select: publicVehicleSelect(new Date()),
          orderBy: PUBLIC_SORTS[sort] ?? PUBLIC_SORTS.newest,
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.vehicle.count({ where }),
      ]);
      return {
        items: items.map(publicVehicle),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    },

    async publicDetail({ id }) {
      const vehicle = await prisma.vehicle.findFirst({
        where: { id, isPublished: true, status: 'ACTIVE', archivedAt: null },
        select: publicVehicleSelect(new Date()),
      });
      if (!vehicle) {
        throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
      }
      return publicVehicle(vehicle);
    },
    async list({ query, actor, permissions }) {
      const now = new Date();
      const canViewAll = permissions.includes('vehicles.view');
      const canViewPricing = permissions.includes('vehicles.pricing.view');
      const overdueMileageVehicleIds =
        query.maintenance === 'overdue'
          ? (
              await prisma.$queryRaw`
                SELECT DISTINCT v.id
                FROM Vehicle AS v
                WHERE v.currentOdometerKm IS NOT NULL
                  AND (
                    EXISTS (
                      SELECT 1
                      FROM MaintenanceSchedule AS ms
                      WHERE ms.vehicleId = v.id
                        AND ms.status = 'ACTIVE'
                        AND ms.dueAtOdometerKm IS NOT NULL
                        AND ms.dueAtOdometerKm <= v.currentOdometerKm
                    )
                    OR EXISTS (
                      SELECT 1
                      FROM MaintenanceJob AS mj
                      WHERE mj.vehicleId = v.id
                        AND mj.status = 'COMPLETED'
                        AND mj.nextServiceOdometerKm IS NOT NULL
                        AND mj.nextServiceOdometerKm <= v.currentOdometerKm
                    )
                  )
              `
            ).map(({ id }) => id)
          : [];
      const { where, orderBy } = buildListWhere(
        query,
        actor,
        now,
        canViewAll,
        canViewPricing,
        config.DOCUMENT_EXPIRY_WARNING_DAYS,
        overdueMileageVehicleIds,
      );
      const include = vehicleInclude(now, canViewPricing);
      const [vehicles, total] = await prisma.$transaction([
        prisma.vehicle.findMany({
          where,
          include,
          orderBy,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        prisma.vehicle.count({ where }),
      ]);
      return {
        items: vehicles.map((vehicle) => vehicleSummary(vehicle, now, canViewPricing)),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          pages: Math.ceil(total / query.limit),
        },
      };
    },

    async getById({ id, actor, permissions }) {
      await ensureAssignedVehicle(prisma, id, actor, permissions);
      const now = new Date();
      const vehicle = await prisma.vehicle.findUnique({
        where: { id },
        include: {
          ...vehicleInclude(now, permissions.includes('vehicles.pricing.view')),
          statusHistory: {
            orderBy: { changedAt: 'desc' },
            take: 25,
            include: { actor: { select: { id: true, displayName: true } } },
          },
          mileageReadings: {
            orderBy: { recordedAt: 'desc' },
            take: 10,
          },
        },
      });
      if (!vehicle) {
        throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
      }
      return {
        ...vehicleSummary(vehicle, now, permissions.includes('vehicles.pricing.view')),
        documentExpiryWarningDays: config.DOCUMENT_EXPIRY_WARNING_DAYS,
        internalNotes: permissions.includes('vehicles.update') ? vehicle.internalNotes : undefined,
        engineNumber: permissions.includes('vehicles.update') ? vehicle.engineNumber : undefined,
        chassisNumber: permissions.includes('vehicles.update') ? vehicle.chassisNumber : undefined,
        statusHistory: vehicle.statusHistory,
        mileageReadings: vehicle.mileageReadings.map((reading) => ({
          ...reading,
          readingKm: reading.readingKm,
        })),
      };
    },

    async create({ input, actor, auditContext }) {
      const { specification, currentOdometerKm, initialOdometerReason, ...fields } = input;
      try {
        return await prisma.$transaction(async (tx) => {
          const vehicle = await tx.vehicle.create({
            data: {
              ...fields,
              publishedAt: fields.isPublished ? new Date() : null,
              registrationNumber: fields.registrationNumber.trim().toUpperCase(),
              vin: fields.vin?.trim().toUpperCase() ?? null,
              chassisNumber: fields.chassisNumber?.trim().toUpperCase() ?? null,
              engineNumber: fields.engineNumber?.trim().toUpperCase() ?? null,
              acquisitionDate: mapDateOnly(fields.acquisitionDate),
              currentOdometerKm: currentOdometerKm ?? null,
              specification: {
                create: {
                  ...specification,
                  make: specification.make.trim(),
                  model: specification.model.trim(),
                },
              },
            },
            include: { specification: true },
          });
          await tx.vehicleStatusHistory.create({
            data: {
              vehicleId: vehicle.id,
              changedByStaffId: actor.id,
              toStatus: vehicle.status,
              reason: 'Vehicle created.',
            },
          });
          if (currentOdometerKm !== undefined) {
            await tx.vehicleMileageReading.create({
              data: {
                vehicleId: vehicle.id,
                recordedByStaffId: actor.id,
                readingKm: currentOdometerKm,
                source: 'MANUAL',
                reason: initialOdometerReason,
              },
            });
          }
          await writeAudit(tx, {
            ...actorAuditFields(actor),
            action: 'vehicle.created',
            entityType: 'Vehicle',
            entityId: vehicle.id,
            ...auditContext,
            afterSnapshot: vehicleAuditSnapshot(vehicle),
          });
          return vehicle;
        });
      } catch (error) {
        translateVehicleUniqueError(error);
      }
    },

    async update({ id, input, actor, auditContext }) {
      const { specification, ...fields } = input;
      try {
        return await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM Vehicle WHERE id = ${id} FOR UPDATE`;
          await getActiveVehicle(tx, id);
          const currentWithSpec = await tx.vehicle.findUnique({
            where: { id },
            include: { specification: true },
          });
          const data = {
            ...(fields.registrationNumber === undefined
              ? {}
              : { registrationNumber: fields.registrationNumber.trim().toUpperCase() }),
            ...(fields.vin === undefined ? {} : { vin: fields.vin?.trim().toUpperCase() ?? null }),
            ...(fields.chassisNumber === undefined
              ? {}
              : { chassisNumber: fields.chassisNumber?.trim().toUpperCase() ?? null }),
            ...(fields.engineNumber === undefined
              ? {}
              : { engineNumber: fields.engineNumber?.trim().toUpperCase() ?? null }),
            ...(fields.acquisitionDate === undefined
              ? {}
              : { acquisitionDate: mapDateOnly(fields.acquisitionDate) }),
            ...(fields.description === undefined ? {} : { description: fields.description }),
            ...(fields.publicDescription === undefined
              ? {}
              : { publicDescription: fields.publicDescription }),
            ...(fields.isPublished === undefined || fields.isPublished === currentWithSpec.isPublished
              ? {}
              : publicationData(fields.isPublished, currentWithSpec)),
            ...(fields.internalNotes === undefined ? {} : { internalNotes: fields.internalNotes }),
          };
          if (specification) {
            const specificationData = {
              ...specification,
              ...(specification.make === undefined ? {} : { make: specification.make.trim() }),
              ...(specification.model === undefined ? {} : { model: specification.model.trim() }),
            };
            if (currentWithSpec.specification) {
              await tx.vehicleSpecification.update({
                where: { vehicleId: id },
                data: specificationData,
              });
            } else {
              await tx.vehicleSpecification.create({
                data: { vehicleId: id, ...specificationData },
              });
            }
          }
          const updated = Object.keys(data).length
            ? await tx.vehicle.update({ where: { id }, data, include: { specification: true } })
            : await tx.vehicle.findUnique({ where: { id }, include: { specification: true } });
          await writeAudit(tx, {
            ...actorAuditFields(actor),
            action: 'vehicle.updated',
            entityType: 'Vehicle',
            entityId: id,
            ...auditContext,
            beforeSnapshot: vehicleAuditSnapshot(currentWithSpec),
            afterSnapshot: vehicleAuditSnapshot(updated),
          });
          return updated;
        });
      } catch (error) {
        translateVehicleUniqueError(error);
      }
    },

    async setPublication({ id, isPublished, actor, auditContext }) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM Vehicle WHERE id = ${id} FOR UPDATE`;
        const current = await getActiveVehicle(tx, id);
        if (current.isPublished === isPublished) {
          return tx.vehicle.findUnique({ where: { id }, include: { specification: true } });
        }
        const updated = await tx.vehicle.update({
          where: { id },
          data: publicationData(isPublished, current),
          include: { specification: true },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: isPublished ? 'vehicle.published' : 'vehicle.unpublished',
          entityType: 'Vehicle',
          entityId: id,
          ...auditContext,
          beforeSnapshot: { isPublished: current.isPublished, publishedAt: current.publishedAt },
          afterSnapshot: { isPublished: updated.isPublished, publishedAt: updated.publishedAt },
        });
        return updated;
      });
    },

    async publicPreview({ id }) {
      const vehicle = await prisma.vehicle.findFirst({
        where: { id, archivedAt: null },
        select: publicVehicleSelect(new Date()),
      });
      if (!vehicle) {
        throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
      }
      return publicVehicle(vehicle);
    },

    async updateStatus({ id, status, reason, actor, auditContext }) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM Vehicle WHERE id = ${id} FOR UPDATE`;
        const current = await getActiveVehicle(tx, id);
        if (current.status === status) {
          throw new AppError(409, 'VEHICLE_STATUS_UNCHANGED', 'The vehicle already has that lifecycle status.');
        }
        if (status !== 'ACTIVE') {
          const now = new Date();
          const activeReservation = await tx.booking.findFirst({
            where: {
              vehicleId: id,
              OR: [
                { status: 'HANDED_OVER' },
                { status: 'CONFIRMED', returnAt: { gt: now } },
              ],
            },
            select: { id: true },
          });
          if (activeReservation) {
            throw new AppError(
              409,
              'VEHICLE_HAS_ACTIVE_BOOKINGS',
              'A vehicle with an active or upcoming confirmed booking cannot be made inactive or retired.',
            );
          }
        }
        const updated = await tx.vehicle.update({ where: { id }, data: { status } });
        await tx.vehicleStatusHistory.create({
          data: {
            vehicleId: id,
            changedByStaffId: actor.id,
            fromStatus: current.status,
            toStatus: status,
            reason,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'vehicle.status_changed',
          entityType: 'Vehicle',
          entityId: id,
          ...auditContext,
          beforeSnapshot: { status: current.status },
          afterSnapshot: { status, reason },
        });
        return updated;
      });
    },

    async archive({ id, reason, actor, auditContext }) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM Vehicle WHERE id = ${id} FOR UPDATE`;
        const current = await getActiveVehicle(tx, id);
        const now = new Date();
        const activeBooking = await tx.booking.findFirst({
          where: {
            vehicleId: id,
            OR: [
              { status: 'HANDED_OVER' },
              { status: 'CONFIRMED', returnAt: { gt: now } },
            ],
          },
          select: { id: true },
        });
        if (activeBooking) {
          throw new AppError(
            409,
            'VEHICLE_HAS_ACTIVE_BOOKINGS',
            'A vehicle with an active or upcoming confirmed booking cannot be archived.',
          );
        }
        await tx.vehicle.update({
          where: { id },
          data: { status: 'RETIRED', archivedAt: now },
        });
        await tx.vehicleStatusHistory.create({
          data: {
            vehicleId: id,
            changedByStaffId: actor.id,
            fromStatus: current.status,
            toStatus: 'RETIRED',
            reason,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: 'vehicle.archived',
          entityType: 'Vehicle',
          entityId: id,
          ...auditContext,
          beforeSnapshot: vehicleAuditSnapshot(current),
          afterSnapshot: { status: 'RETIRED', archivedAt: now, reason },
        });
        return { id, archivedAt: now, status: 'RETIRED' };
      });
    },

    async mileageHistory({ id, page, limit, actor, permissions }) {
      await ensureAssignedVehicle(prisma, id, actor, permissions);
      const vehicle = await prisma.vehicle.findUnique({ where: { id }, select: { id: true } });
      if (!vehicle) {
        throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
      }
      const where = { vehicleId: id };
      const [items, total] = await prisma.$transaction([
        prisma.vehicleMileageReading.findMany({
          where,
          include: { recordedBy: { select: { id: true, displayName: true } } },
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.vehicleMileageReading.count({ where }),
      ]);
      return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
    },

    async recordMileage({ id, readingKm, reason, correction, actor, permissions, auditContext }) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM Vehicle WHERE id = ${id} FOR UPDATE`;
        await ensureAssignedVehicle(tx, id, actor, permissions);
        const vehicle = await getActiveVehicle(tx, id);
        const previousOdometerKm = vehicle.currentOdometerKm;
        if (correction) {
          if (previousOdometerKm === null) {
            throw new AppError(
              409,
              'NO_MILEAGE_TO_CORRECT',
              'The vehicle does not have a recorded odometer reading to correct.',
            );
          }
          if (readingKm >= previousOdometerKm) {
            throw new AppError(
              400,
              'MILEAGE_CORRECTION_MUST_DECREASE',
              'A correction must be lower than the current odometer reading.',
            );
          }
        } else if (previousOdometerKm !== null && readingKm < previousOdometerKm) {
          throw new AppError(
            409,
            'MILEAGE_CANNOT_DECREASE',
            'Use the mileage correction operation to correct a lower reading.',
          );
        }
        const source = correction ? 'CORRECTION' : 'MANUAL';
        const updated = await tx.vehicle.update({
          where: { id },
          data: { currentOdometerKm: readingKm },
        });
        const entry = await tx.vehicleMileageReading.create({
          data: {
            vehicleId: id,
            recordedByStaffId: actor.id,
            readingKm,
            previousOdometerKm,
            source,
            reason,
          },
        });
        await writeAudit(tx, {
          ...actorAuditFields(actor),
          action: correction ? 'vehicle.mileage_corrected' : 'vehicle.mileage_recorded',
          entityType: 'Vehicle',
          entityId: id,
          ...auditContext,
          beforeSnapshot: { currentOdometerKm: previousOdometerKm },
          afterSnapshot: { currentOdometerKm: readingKm, reason, readingId: entry.id },
        });
        return { vehicle: updated, reading: entry };
      });
    },

    async maintenanceHistory({ id, actor, permissions, page, limit }) {
      await ensureAssignedVehicle(prisma, id, actor, permissions);
      const vehicle = await prisma.vehicle.findUnique({ where: { id }, select: { id: true } });
      if (!vehicle) {
        throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
      }
      const where = { vehicleId: id };
      const [items, total, schedules] = await Promise.all([
        prisma.maintenanceJob.findMany({
          where,
          include: {
            category: { select: { id: true, code: true, name: true } },
            availabilityBlock: { select: { id: true, status: true, startsAt: true, endsAt: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.maintenanceJob.count({ where }),
        prisma.maintenanceSchedule.findMany({
          where: { vehicleId: id },
          include: { category: { select: { id: true, code: true, name: true } } },
          orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
        }),
      ]);
      return {
        items,
        schedules,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    },

    async bookingHistory({ id, page, limit, actor, permissions }) {
      await ensureAssignedVehicle(prisma, id, actor, permissions);
      const vehicle = await prisma.vehicle.findUnique({ where: { id }, select: { id: true } });
      if (!vehicle) {
        throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
      }
      const where = { vehicleId: id };
      const [items, total] = await prisma.$transaction([
        prisma.booking.findMany({
          where,
          select: {
            id: true,
            reference: true,
            status: true,
            pickupAt: true,
            returnAt: true,
            rentalPriceSnapshot: true,
            estimatedTotal: true,
            confirmedTotal: true,
            currency: true,
            createdAt: true,
            customerNameSnapshot: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.booking.count({ where }),
      ]);
      return {
        items: items.map((item) => ({
          ...item,
          rentalPriceSnapshot: item.rentalPriceSnapshot.toString(),
          estimatedTotal: item.estimatedTotal.toString(),
          confirmedTotal: item.confirmedTotal?.toString() ?? null,
        })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    },

    async auditHistory({ id, page, limit, actor, permissions }) {
      await ensureAssignedVehicle(prisma, id, actor, permissions);
      if (!(await prisma.vehicle.findUnique({ where: { id }, select: { id: true } }))) {
        throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
      }
      const where = {
        entityId: id,
        entityType: 'Vehicle',
      };
      const [items, total] = await prisma.$transaction([
        prisma.auditLog.findMany({
          where,
          include: { actor: { select: { id: true, displayName: true, emailNormalized: true } } },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.auditLog.count({ where }),
      ]);
      return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
    },

    async publicImage({ vehicleId, imageId }) {
      const image = await prisma.vehicleImage.findFirst({
        where: {
          id: imageId,
          vehicleId,
          isPublished: true,
          archivedAt: null,
          vehicle: { status: 'ACTIVE', archivedAt: null, isPublished: true },
        },
        select: { storageKey: true, mimeType: true, sha256: true },
      });
      if (!image) {
        throw new AppError(404, 'VEHICLE_IMAGE_NOT_FOUND', 'Published vehicle image was not found.');
      }
      return { ...image, buffer: await storage.get(image.storageKey) };
    },
  };
}
