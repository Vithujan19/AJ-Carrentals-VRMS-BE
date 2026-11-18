import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createBookingService } from '../src/modules/bookings/booking.service.js';
import { createVehicleService } from '../src/modules/vehicles/vehicle.service.js';

describe('public booking data', () => {
  it('omits registration and does not search registration in public availability', async () => {
    const vehicle = {
      id: 'vehicle-1',
      registrationNumber: 'PRIVATE-1234',
      specification: { make: 'Example', model: 'Car' },
      images: [],
      rates: [],
    };
    const findMany = vi.fn().mockResolvedValue([vehicle]);
    const prisma = {
      rentalPolicy: { findFirst: vi.fn().mockResolvedValue(null) },
      vehicle: { findMany, count: vi.fn().mockResolvedValue(1) },
      $transaction: vi.fn((operations) => Promise.all(operations)),
    };
    const service = createBookingService({ prisma });
    const query = {
      pickupAt: '2099-01-01T04:30:00.000Z',
      returnAt: '2099-01-02T04:30:00.000Z',
      search: 'PRIVATE-1234',
      page: 1,
      limit: 20,
    };

    const publicResult = await service.availableVehicles({ query, publicOnly: true });
    expect(publicResult.items[0]).not.toHaveProperty('registrationNumber');
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).not.toContain('registrationNumber');
    expect(findMany.mock.calls[0][0].where.AND).toContainEqual({ isPublished: true });

    const staffResult = await service.availableVehicles({
      query,
      actor: { id: 'staff-1' },
      permissions: ['bookings.view'],
    });
    expect(staffResult.items[0].registrationNumber).toBe('PRIVATE-1234');
    expect(JSON.stringify(findMany.mock.calls[1][0].where)).toContain('registrationNumber');
    expect(findMany.mock.calls[1][0].where.AND).not.toContainEqual({ isPublished: true });
  });

  it('rejects booking requests for an unpublished vehicle', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'vehicle-1' }]),
      vehicle: { findUnique: vi.fn().mockResolvedValue({ isPublished: false }) },
    };
    const prisma = { $transaction: vi.fn((operation) => operation(tx)) };
    const service = createBookingService({ prisma });
    await expect(service.createPublicRequest({
      input: {
        vehicleId: 'vehicle-1',
        pickupAt: '2099-01-01T04:30:00.000Z',
        returnAt: '2099-01-02T04:30:00.000Z',
      },
      auditContext: {},
    })).rejects.toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
  });

  it('limits public images to published vehicles', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = createVehicleService({
      prisma: { vehicleImage: { findFirst } },
      config: {},
      storage: {},
    });
    await expect(service.publicImage({ vehicleId: 'vehicle-1', imageId: 'image-1' }))
      .rejects.toMatchObject({ code: 'VEHICLE_IMAGE_NOT_FOUND' });
    expect(findFirst.mock.calls[0][0].where).toMatchObject({
      isPublished: true,
      vehicle: { isPublished: true, status: 'ACTIVE', archivedAt: null },
    });
  });

  it('returns only public fields after a verified booking lookup', async () => {
    const token = 'a'.repeat(32);
    const record = {
      id: 'internal-id',
      reference: 'AJR-2099-000001',
      status: 'PENDING',
      publicLookupTokenHash: createHash('sha256').update(token).digest('hex'),
      registrationSnapshot: 'PRIVATE-1234',
      internalNotes: 'Internal only',
      customerNameSnapshot: 'Customer',
      customerMobileSnapshot: '0710000000',
      customerEmailSnapshot: null,
      customer: { id: 'customer-id', fullName: 'Customer' },
      vehicle: {
        id: 'vehicle-id',
        registrationNumber: 'PRIVATE-1234',
        specification: { make: 'Example', model: 'Car' },
        images: [],
      },
      rentalDurationUnits: '1',
      rentalPriceSnapshot: '100',
      additionalKmRateSnapshot: '10',
      securityDepositSnapshot: '0',
      estimatedTotal: '100',
      confirmedTotal: null,
      currency: 'LKR',
      charges: [],
      payments: [],
      depositApplications: [],
      statusHistory: [],
    };
    const prisma = { booking: { findUnique: vi.fn().mockResolvedValue(record) } };
    const service = createBookingService({ prisma });

    const result = await service.publicLookup({ reference: record.reference, token });
    expect(result).toMatchObject({
      reference: record.reference,
      status: 'PENDING',
      vehicle: { specification: { make: 'Example', model: 'Car' } },
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE-1234');
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('internalNotes');
    expect(result).not.toHaveProperty('customer');
    await expect(service.publicLookup({ reference: record.reference, token: 'b'.repeat(32) }))
      .rejects.toMatchObject({ code: 'BOOKING_LOOKUP_NOT_FOUND' });
  });

  it('returns only clipped unavailable ranges for a published vehicle calendar', async () => {
    const from = new Date('2099-01-01T00:00:00.000Z');
    const to = new Date('2099-01-31T00:00:00.000Z');
    const prisma = {
      vehicle: { findFirst: vi.fn().mockResolvedValue({ id: 'vehicle-1' }) },
      booking: { findMany: vi.fn().mockResolvedValue([
        { pickupAt: new Date('2098-12-30T00:00:00.000Z'), returnAt: new Date('2099-01-03T00:00:00.000Z'), customerNameSnapshot: 'Private' },
      ]) },
      vehicleAvailabilityBlock: { findMany: vi.fn().mockResolvedValue([
        { startsAt: new Date('2099-01-10T00:00:00.000Z'), endsAt: null },
      ]) },
      maintenanceJob: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const result = await createBookingService({ prisma }).publicVehicleCalendar({ vehicleId: 'vehicle-1', from, to });
    expect(result.unavailable).toEqual([
      { start: '2099-01-01T00:00:00.000Z', end: '2099-01-03T00:00:00.000Z' },
      { start: '2099-01-10T00:00:00.000Z', end: '2099-01-31T00:00:00.000Z' },
    ]);
    expect(JSON.stringify(result)).not.toContain('Private');
    expect(prisma.vehicle.findFirst.mock.calls[0][0].where).toMatchObject({ isPublished: true, status: 'ACTIVE' });
  });

  it('hides the calendar of an unpublished vehicle', async () => {
    const prisma = { vehicle: { findFirst: vi.fn().mockResolvedValue(null) } };
    await expect(createBookingService({ prisma }).publicVehicleCalendar({
      vehicleId: 'v', from: new Date(), to: new Date(Date.now() + 1000),
    })).rejects.toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
  });

  it('records WhatsApp opened and revoked consent only with the lookup token', async () => {
    const token = 'b'.repeat(32);
    const hash = createHash('sha256').update(token).digest('hex');
    const prisma = {
      booking: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'booking-1', publicLookupTokenHash: hash, whatsappOpenedAt: null, whatsappConsent: true, whatsappConsentRevokedAt: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn() },
    };
    const service = createBookingService({ prisma });
    await expect(service.recordWhatsAppOpened({ reference: 'R', token: 'c'.repeat(32) })).rejects.toMatchObject({ code: 'BOOKING_LOOKUP_NOT_FOUND' });
    await service.recordWhatsAppOpened({ reference: 'R', token });
    await service.revokeWhatsAppConsent({ reference: 'R', token });
    expect(Object.keys(prisma.booking.update.mock.calls[0][0].data)).toEqual(['whatsappOpenedAt']);
    expect(Object.keys(prisma.booking.update.mock.calls[1][0].data)).toEqual(['whatsappConsentRevokedAt']);
  });
});
