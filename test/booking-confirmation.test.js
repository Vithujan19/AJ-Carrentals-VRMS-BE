import { describe, expect, it, vi } from 'vitest';
import { createBookingService } from '../src/modules/bookings/booking.service.js';

function createSerializedPrisma() {
  const vehicleId = 'vehicle-1';
  const pickupAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const returnAt = new Date(pickupAt.getTime() + 24 * 60 * 60 * 1000);
  const bookings = new Map([
    ['booking-1', {
      id: 'booking-1',
      vehicleId,
      status: 'PENDING',
      pickupAt,
      returnAt,
      estimatedTotal: { toString: () => '100.00' },
      currency: 'LKR',
    }],
    ['booking-2', {
      id: 'booking-2',
      vehicleId,
      status: 'PENDING',
      pickupAt,
      returnAt,
      estimatedTotal: { toString: () => '100.00' },
      currency: 'LKR',
    }],
  ]);
  let lockQueue = Promise.resolve();

  async function acquireVehicleLock() {
    const previous = lockQueue;
    let release;
    lockQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    return release;
  }

  const prisma = {
    booking: {
      findUnique: vi.fn(async ({ where }) => {
        const booking = bookings.get(where.id);
        return booking ? { vehicleId: booking.vehicleId } : null;
      }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (operation) => {
      let releaseVehicleLock;
      const tx = {
        $queryRaw: vi.fn(async (parts) => {
          if (parts.join('').includes('FROM Vehicle')) {
            releaseVehicleLock = await acquireVehicleLock();
            return [{ id: vehicleId }];
          }
          return [];
        }),
        vehicle: {
          findUnique: vi.fn().mockResolvedValue({
            id: vehicleId,
            status: 'ACTIVE',
            archivedAt: null,
          }),
        },
        booking: {
          findUnique: vi.fn(async ({ where }) => bookings.get(where.id) ?? null),
          findFirst: vi.fn(async ({ where }) => {
            for (const candidate of bookings.values()) {
              if (candidate.vehicleId !== where.vehicleId || candidate.id === where.id?.not) {
                continue;
              }
              if (
                candidate.status === 'CONFIRMED'
                && candidate.pickupAt < where.OR[0].pickupAt.lt
                && candidate.returnAt > where.OR[0].returnAt.gt
              ) {
                return { id: candidate.id };
              }
            }
            return null;
          }),
          update: vi.fn(async ({ where, data }) => {
            const booking = bookings.get(where.id);
            Object.assign(booking, data);
            return booking;
          }),
        },
        rentalPolicy: { findFirst: vi.fn().mockResolvedValue(null) },
        vehicleStaffAssignment: { findFirst: vi.fn().mockResolvedValue({ id: 'assignment-1' }) },
        vehicleAvailabilityBlock: { findFirst: vi.fn().mockResolvedValue(null) },
        maintenanceJob: { findFirst: vi.fn().mockResolvedValue(null) },
        bookingStatusHistory: { create: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      };
      try {
        return await operation(tx);
      } finally {
        releaseVehicleLock?.();
      }
    }),
  };
  return prisma;
}

describe('booking confirmation concurrency', () => {
  it('allows only one overlapping pending booking to be confirmed', async () => {
    const prisma = createSerializedPrisma();
    const service = createBookingService({ prisma, logger: { warn: vi.fn() } });
    const input = {
      actor: { id: 'staff-1', email: 'staff@example.test' },
      permissions: ['bookings.confirm'],
    };

    const results = await Promise.allSettled([
      service.confirm({ ...input, id: 'booking-1' }),
      service.confirm({ ...input, id: 'booking-2' }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected').reason.code)
      .toBe('BOOKING_AVAILABILITY_CONFLICT');
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
  });
});
