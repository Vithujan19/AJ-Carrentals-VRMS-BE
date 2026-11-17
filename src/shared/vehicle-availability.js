import { AppError } from './errors.js';

export function blockingBookingWhere(from, to, excludeBookingId) {
  return {
    ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    OR: [
      {
        status: 'CONFIRMED',
        pickupAt: { lt: to },
        returnAt: { gt: from },
      },
      {
        status: 'HANDED_OVER',
        OR: [
          {
            handover: { is: null },
            pickupAt: { lt: to },
          },
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
  };
}

export function blockingAvailabilityBlockWhere(from, to) {
  return {
    status: 'ACTIVE',
    startsAt: { lt: to },
    OR: [{ endsAt: null }, { endsAt: { gt: from } }],
  };
}

export function blockingMaintenanceWhere(from, to) {
  return {
    OR: [
      {
        status: 'IN_PROGRESS',
        OR: [{ estimatedCompletionAt: null }, { estimatedCompletionAt: { gt: from } }],
      },
      {
        status: 'SCHEDULED',
        scheduledStartAt: { lt: to },
        OR: [{ estimatedCompletionAt: null }, { estimatedCompletionAt: { gt: from } }],
      },
    ],
  };
}

export function dateAvailabilityWhere(from, to, excludeBookingId) {
  return {
    AND: [
      { bookings: { none: blockingBookingWhere(from, to, excludeBookingId) } },
      { availabilityBlocks: { none: blockingAvailabilityBlockWhere(from, to) } },
      { maintenanceJobs: { none: blockingMaintenanceWhere(from, to) } },
    ],
  };
}

export async function assertVehicleAvailable(tx, {
  vehicleId,
  from,
  to,
  excludeBookingId,
}) {
  const vehicle = await tx.vehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, status: true, archivedAt: true },
  });
  if (!vehicle) {
    throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
  }
  if (vehicle.archivedAt || vehicle.status !== 'ACTIVE') {
    throw new AppError(409, 'VEHICLE_NOT_RENTABLE', 'This vehicle is not available for rental.');
  }

  const [booking, block, maintenance] = await Promise.all([
    tx.booking.findFirst({
      where: {
        vehicleId,
        ...blockingBookingWhere(from, to, excludeBookingId),
      },
      select: { id: true },
    }),
    tx.vehicleAvailabilityBlock.findFirst({
      where: {
        vehicleId,
        ...blockingAvailabilityBlockWhere(from, to),
      },
      select: { id: true },
    }),
    tx.maintenanceJob.findFirst({
      where: {
        vehicleId,
        ...blockingMaintenanceWhere(from, to),
      },
      select: { id: true },
    }),
  ]);
  if (booking || block || maintenance) {
    throw new AppError(
      409,
      'BOOKING_AVAILABILITY_CONFLICT',
      'The vehicle is not available for the selected rental period.',
    );
  }
}
