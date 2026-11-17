import { describe, expect, it, vi } from 'vitest';
import { createBookingService } from '../src/modules/bookings/booking.service.js';

describe('booking list response mapping', () => {
  it('handles list queries that intentionally omit detail-only relations', async () => {
    const record = {
      id: 'booking-1',
      status: 'PENDING',
      createdAt: new Date('2027-01-01T00:00:00.000Z'),
      updatedAt: new Date('2027-01-01T00:00:00.000Z'),
      vehicle: {
        id: 'vehicle-1',
        registrationNumber: 'ABC-1234',
        specification: null,
        images: [],
      },
      rentalDurationUnits: { toString: () => '1.00' },
      rentalPriceSnapshot: { toString: () => '1000.00' },
      additionalKmRateSnapshot: { toString: () => '10.00' },
      securityDepositSnapshot: { toString: () => '5000.00' },
      estimatedTotal: { toString: () => '1000.00' },
      confirmedTotal: null,
    };
    const prisma = {
      booking: {
        findMany: vi.fn().mockResolvedValue([record]),
        count: vi.fn().mockResolvedValue(1),
      },
      $transaction: vi.fn((operations) => Promise.all(operations)),
    };
    const service = createBookingService({ prisma });

    const result = await service.list({
      query: {
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      },
      actor: { id: 'staff-1' },
      permissions: ['bookings.view'],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].statusHistory).toEqual([]);
    expect(result.items[0].scheduleChanges).toBeUndefined();
    expect(result.pagination.total).toBe(1);
  });
});
