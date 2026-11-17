import { AppError } from './errors.js';

export async function lockVehicle(tx, vehicleId) {
  const rows = await tx.$queryRaw`
    SELECT id
    FROM Vehicle
    WHERE id = ${vehicleId}
    FOR UPDATE
  `;
  if (!rows.length) {
    throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
  }
}

export async function lockVehicles(tx, vehicleIds) {
  for (const id of [...new Set(vehicleIds)].sort()) {
    await lockVehicle(tx, id);
  }
}

export async function lockBooking(tx, id, vehicleId) {
  await lockVehicle(tx, vehicleId);
  await tx.$queryRaw`SELECT id FROM Booking WHERE id = ${id} FOR UPDATE`;
  const booking = await tx.booking.findUnique({ where: { id } });
  if (!booking) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking was not found.');
  }
  if (booking.vehicleId !== vehicleId) {
    throw new AppError(409, 'BOOKING_CHANGED', 'The booking changed. Reload it and try again.');
  }
  return booking;
}

export async function bookingVehicleId(prisma, id) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { vehicleId: true },
  });
  if (!booking) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking was not found.');
  }
  return booking.vehicleId;
}

export async function assertAssignedVehicle(tx, vehicleId, actor, permissions) {
  if (permissions?.includes('bookings.view')) return;
  const assignment = await tx.vehicleStaffAssignment.findFirst({
    where: {
      vehicleId,
      staffUserId: actor.id,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (!assignment) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking was not found.');
  }
}

export async function runBookingTransaction(prisma, operation) {
  const attempts = 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: 'ReadCommitted',
        maxWait: 5000,
        timeout: 15000,
      });
    } catch (error) {
      if (error?.code !== 'P2034' || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  throw new Error('Booking transaction retry limit was exceeded.');
}
