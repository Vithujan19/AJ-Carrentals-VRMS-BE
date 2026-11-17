import { describe, expect, it, vi } from 'vitest';
import { createVehicleService } from '../src/modules/vehicles/vehicle.service.js';

function createTransactionMocks(vehicle) {
  const tx = {
    $queryRaw: vi.fn(),
    vehicle: {
      findUnique: vi.fn().mockResolvedValue(vehicle),
      update: vi.fn().mockImplementation(async ({ data }) => ({ ...vehicle, ...data })),
    },
    vehicleMileageReading: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'reading-id', ...data })),
    },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-id' }) },
  };
  const prisma = {
    $transaction: vi.fn((operation) => operation(tx)),
  };
  return { prisma, tx };
}

describe('vehicle mileage recording', () => {
  it('rejects a decreasing reading unless it is an explicit correction', async () => {
    const { prisma, tx } = createTransactionMocks({
      id: 'vehicle-id',
      status: 'ACTIVE',
      archivedAt: null,
      currentOdometerKm: 1200,
    });
    const service = createVehicleService({
      prisma,
      config: { DOCUMENT_EXPIRY_WARNING_DAYS: 30 },
      storage: {},
    });

    await expect(service.recordMileage({
      id: 'vehicle-id',
      readingKm: 1190,
      reason: 'Dashboard was checked',
      correction: false,
      actor: { id: 'staff-id', email: 'staff@example.lk' },
      permissions: ['vehicles.view'],
      auditContext: {},
    })).rejects.toMatchObject({
      status: 409,
      code: 'MILEAGE_CANNOT_DECREASE',
    });
    expect(tx.vehicle.update).not.toHaveBeenCalled();
    expect(tx.vehicleMileageReading.create).not.toHaveBeenCalled();
  });

  it('records an explicit lower-reading correction with its reason and previous value', async () => {
    const { prisma, tx } = createTransactionMocks({
      id: 'vehicle-id',
      status: 'ACTIVE',
      archivedAt: null,
      currentOdometerKm: 1200,
    });
    const service = createVehicleService({
      prisma,
      config: { DOCUMENT_EXPIRY_WARNING_DAYS: 30 },
      storage: {},
    });

    const result = await service.recordMileage({
      id: 'vehicle-id',
      readingKm: 1190,
      reason: 'Correcting a transcription error',
      correction: true,
      actor: { id: 'staff-id', email: 'staff@example.lk' },
      permissions: ['vehicles.view'],
      auditContext: {},
    });

    expect(result.reading).toMatchObject({
      readingKm: 1190,
      previousOdometerKm: 1200,
      source: 'CORRECTION',
      reason: 'Correcting a transcription error',
    });
    expect(tx.vehicle.update).toHaveBeenCalledWith({
      where: { id: 'vehicle-id' },
      data: { currentOdometerKm: 1190 },
    });
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });
});

describe('vehicle availability period filtering', () => {
  it('uses a half-open interval for booking and operational block conflicts', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = {
      vehicle: { findMany, count },
      $transaction: vi.fn((operations) => Promise.all(operations)),
    };
    const service = createVehicleService({
      prisma,
      config: { DOCUMENT_EXPIRY_WARNING_DAYS: 30 },
      storage: {},
    });

    await service.list({
      query: {
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        availableFrom: '2027-01-01T10:00:00+05:30',
        availableTo: '2027-01-03T10:00:00+05:30',
      },
      actor: { id: 'staff-id' },
      permissions: ['vehicles.view'],
    });

    const where = findMany.mock.calls[0][0].where;
    const availability = where.AND.find((condition) => condition.AND);
    expect(availability.AND[0].bookings.none.OR[0]).toMatchObject({
      pickupAt: { lt: new Date('2027-01-03T04:30:00.000Z') },
      returnAt: { gt: new Date('2027-01-01T04:30:00.000Z') },
    });
    expect(availability.AND[1].availabilityBlocks.none.startsAt).toEqual({
      lt: new Date('2027-01-03T04:30:00.000Z'),
    });
  });
});
