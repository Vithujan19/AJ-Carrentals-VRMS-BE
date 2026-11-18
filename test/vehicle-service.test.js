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

describe('vehicle audit history', () => {
  it('orders and returns audit events by their recorded occurrence time', async () => {
    const event = {
      id: 'audit-id',
      occurredAt: new Date('2026-01-02T03:04:05Z'),
      action: 'vehicle.updated',
    };
    const findMany = vi.fn().mockResolvedValue([event]);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = {
      vehicle: { findUnique: vi.fn().mockResolvedValue({ id: 'vehicle-id' }) },
      auditLog: { findMany, count },
      $transaction: vi.fn((operations) => Promise.all(operations)),
    };
    const service = createVehicleService({ prisma, config: {}, storage: {} });

    const result = await service.auditHistory({
      id: 'vehicle-id',
      page: 2,
      limit: 10,
      actor: { id: 'staff-id' },
      permissions: ['vehicles.view', 'vehicles.audit.view'],
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { entityId: 'vehicle-id', entityType: 'Vehicle' },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
    }));
    expect(count).toHaveBeenCalledWith({ where: { entityId: 'vehicle-id', entityType: 'Vehicle' } });
    expect(result.items).toEqual([event]);
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

  describe('public vehicle catalogue', () => {
    const vehicle = {
      id: 'vehicle-id',
      publicDescription: 'A public description',
      internalNotes: 'private',
      vin: 'private',
      specification: { make: 'Toyota', model: 'Corolla' },
      images: [{ id: 'image-id', caption: 'Front' }],
      rates: [],
    };

    it('lists only active, published, unarchived vehicles without date or rate restrictions', async () => {
      const findMany = vi.fn().mockResolvedValue([vehicle]);
      const count = vi.fn().mockResolvedValue(1);
      const prisma = {
        vehicle: { findMany, count },
        $transaction: vi.fn((operations) => Promise.all(operations)),
      };
      const service = createVehicleService({ prisma, config: {}, storage: {} });
      const result = await service.publicList({ query: { page: 2, limit: 12, search: 'Toyota', seatingCapacity: 4 } });
      const request = findMany.mock.calls[0][0];
      expect(request.where).toEqual({
        isPublished: true,
        status: 'ACTIVE',
        archivedAt: null,
        specification: { is: { seatingCapacity: { gte: 4 }, OR: [{ make: { contains: 'Toyota' } }, { model: { contains: 'Toyota' } }] } },
      });
      expect(count).toHaveBeenCalledWith({ where: request.where });
      expect(request.skip).toBe(12);
      expect(request.select.images.where).toEqual({ archivedAt: null, isPublished: true });
      expect(request.select).not.toHaveProperty('vin');
      expect(request.select).not.toHaveProperty('internalNotes');
      expect(request.select).not.toHaveProperty('documents');
      expect(result.items[0]).toEqual({
        id: 'vehicle-id',
        description: 'A public description',
        specification: { make: 'Toyota', model: 'Corolla' },
        images: [{ id: 'image-id', caption: 'Front', url: '/api/v1/public/vehicles/vehicle-id/images/image-id' }],
        rates: [],
      });
      expect(result.pagination).toEqual({ page: 2, limit: 12, total: 1, pages: 1 });
    });

    it('uses the same publication boundary for details and returns 404 when not visible', async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const service = createVehicleService({ prisma: { vehicle: { findFirst } }, config: {}, storage: {} });
      await expect(service.publicDetail({ id: 'vehicle-id' }))
        .rejects.toMatchObject({ status: 404, code: 'VEHICLE_NOT_FOUND' });
      expect(findFirst.mock.calls[0][0].where).toEqual({
        id: 'vehicle-id', isPublished: true, status: 'ACTIVE', archivedAt: null,
      });
    });
  });
});
