import { describe, expect, it } from 'vitest';
import {
  calculateExcessMileage,
  calculateLateReturnCharge,
} from '../src/modules/rental-operations/rental-operations-calculations.js';
import {
  createPaymentSchema,
  handoverPayloadSchema,
  policyConfigurationSchema,
} from '../src/modules/rental-operations/rental-operations.schemas.js';

describe('rental operation calculations', () => {
  it('calculates only excess mileage and returns zero below the allowance', () => {
    expect(calculateExcessMileage(1250, 1000)).toBe(250);
    expect(calculateExcessMileage(900, 1000)).toBe(0);
  });

  it('applies grace and rounds late return time up by configured increments', () => {
    expect(calculateLateReturnCharge({
      scheduledReturnAt: new Date('2027-01-01T10:00:00.000Z'),
      actualReturnAt: new Date('2027-01-01T10:46:00.000Z'),
      graceMinutes: 15,
      ratePerHour: '100.00',
      billingIncrementMinutes: 30,
    })).toEqual({
      units: 2,
      amount: '100.00',
      unitPrice: '50.00',
      chargeableMinutes: 31,
    });
    expect(calculateLateReturnCharge({
      scheduledReturnAt: new Date('2027-01-01T10:00:00.000Z'),
      actualReturnAt: new Date('2027-01-01T10:15:00.000Z'),
      graceMinutes: 15,
      ratePerHour: '100.00',
      billingIncrementMinutes: 30,
    })).toBeNull();
  });
});

describe('rental operation request schemas', () => {
  it('rejects duplicate or invalid handover accessories', () => {
    const payload = {
      actualAt: '2027-01-01T10:00:00+05:30',
      odometerKm: 12000,
      fuelPercent: '75',
      inspectionItems: [{
        componentCode: 'body',
        label: 'Body',
        condition: 'GOOD',
      }],
      accessories: [
        { code: 'key', label: 'Key', supplied: true, quantity: 0, condition: 'GOOD' },
        { code: 'key', label: 'Spare key', supplied: true, quantity: 1, condition: 'GOOD' },
      ],
      damages: [],
    };

    expect(handoverPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects duplicate payment allocations and duplicate policy codes', () => {
    const payment = createPaymentSchema.safeParse({
      params: { bookingId: '00000000-0000-4000-8000-000000000001' },
      body: {
        idempotencyKey: 'operation-payment-key-001',
        purpose: 'PARTIAL',
        method: 'CASH',
        amount: '100.00',
        allocations: [
          { allocationType: 'RENTAL', amount: '50.00' },
          { allocationType: 'RENTAL', amount: '50.00' },
        ],
      },
    });
    expect(payment.success).toBe(false);

    const policy = policyConfigurationSchema.safeParse({
      body: {
        requiredCustomerDocumentTypes: [],
        requireValidDrivingLicence: false,
        requireSecurityDepositBeforeHandover: false,
        allowOutstandingBalanceAtFinalization: false,
        lateReturnRatePerHour: null,
        lateReturnBillingIncrementMinutes: null,
        requiredInspectionComponents: [
          { code: 'body', label: 'Body' },
          { code: 'body', label: 'Exterior' },
        ],
        accessories: [],
      },
    });
    expect(policy.success).toBe(false);
  });
});
