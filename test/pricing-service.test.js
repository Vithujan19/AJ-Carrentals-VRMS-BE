import { describe, expect, it, vi } from 'vitest';
import { createPricingService } from '../src/modules/pricing/pricing.service.js';

function setup({ overlap = false } = {}) {
  const rate = {
    id: 'rate-1',
    vehicleId: 'vehicle-1',
    rentalPackageId: 'package-1',
    rentalPrice: '100.00',
    additionalKmRate: '5.00',
    securityDeposit: '50.00',
    effectiveFrom: new Date(Date.now() + 86_400_000),
    effectiveTo: null,
    isActive: true,
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'vehicle-1' }]),
    vehicle: { findUnique: vi.fn().mockResolvedValue({ id: 'vehicle-1', status: 'ACTIVE', archivedAt: null }) },
    rentalPackage: { findUnique: vi.fn().mockResolvedValue({ id: 'package-1', isActive: true }) },
    vehicleRate: {
      findFirst: vi.fn(async ({ where }) => (
        typeof where.id === 'string' ? rate : overlap ? { id: 'other-rate' } : null
      )),
      create: vi.fn().mockResolvedValue(rate),
      update: vi.fn().mockResolvedValue(rate),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn(async (operation, options) => {
      if ((options?.timeout ?? 5000) < 6000) {
        throw new Error('Simulated remote transaction timeout');
      }
      return operation(tx);
    }),
  };
  return { service: createPricingService({ prisma }), tx, rate };
}

const actor = { id: 'staff-1', email: 'staff@example.test' };
const auditContext = {};

describe('vehicle rate transactions', () => {
  it('creates and audits a rate when database latency exceeds the default timeout', async () => {
    const { service, tx, rate } = setup();
    const result = await service.createRate({
      vehicleId: rate.vehicleId,
      input: { ...rate, effectiveFrom: rate.effectiveFrom.toISOString() },
      actor,
      auditContext,
    });
    expect(result.id).toBe(rate.id);
    expect(tx.vehicleRate.create).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it('rejects overlapping rates without writing a rate or audit', async () => {
    const { service, tx, rate } = setup({ overlap: true });
    await expect(service.createRate({
      vehicleId: rate.vehicleId,
      input: { ...rate, effectiveFrom: rate.effectiveFrom.toISOString() },
      actor,
      auditContext,
    })).rejects.toMatchObject({ code: 'VEHICLE_RATE_PERIOD_OVERLAP' });
    expect(tx.vehicleRate.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('updates and audits a rate with the same remote transaction budget', async () => {
    const { service, tx, rate } = setup();
    await service.updateRate({
      vehicleId: rate.vehicleId,
      rateId: rate.id,
      input: { rentalPrice: '150.00' },
      actor,
      auditContext,
    });
    expect(tx.vehicleRate.update).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });
});
