import { describe, expect, it } from 'vitest';
import { billableRentalUnits, colomboCalendarYear, priceQuote } from '../src/modules/bookings/booking-pricing.js';

const rentalPackage = (rentalPeriod, durationCount = 1) => ({ rentalPeriod, durationCount });

describe('booking quote calculation', () => {
  it('charges whole daily and weekly package periods', () => {
    const pickup = new Date('2027-01-01T04:30:00.000Z');
    expect(billableRentalUnits(
      pickup,
      new Date('2027-01-02T04:30:00.000Z'),
      rentalPackage('DAILY'),
    )).toBe(1);
    expect(billableRentalUnits(
      pickup,
      new Date('2027-01-02T04:30:00.001Z'),
      rentalPackage('DAILY'),
    )).toBe(2);
    expect(billableRentalUnits(
      pickup,
      new Date('2027-01-08T04:30:00.000Z'),
      rentalPackage('WEEKLY'),
    )).toBe(1);
  });

  it('bills monthly periods by Colombo calendar months and clamps month-end dates', () => {
    const pickup = new Date('2027-01-31T04:30:00.000Z');
    expect(billableRentalUnits(
      pickup,
      new Date('2027-02-28T04:30:00.000Z'),
      rentalPackage('MONTHLY'),
    )).toBe(1);
    expect(billableRentalUnits(
      pickup,
      new Date('2027-02-28T04:31:00.000Z'),
      rentalPackage('MONTHLY'),
    )).toBe(2);
    expect(billableRentalUnits(
      new Date('2028-01-31T04:30:00.000Z'),
      new Date('2028-02-29T04:30:00.000Z'),
      rentalPackage('MONTHLY'),
    )).toBe(1);
  });

  it('uses decimal arithmetic for quote lines and assigns reference year in Colombo time', () => {
    const quote = priceQuote({
      rate: { rentalPrice: '1000.50', currency: 'LKR' },
      rentalPackage: rentalPackage('DAILY'),
      pickupAt: new Date('2027-01-01T04:30:00.000Z'),
      returnAt: new Date('2027-01-03T04:30:00.000Z'),
      adjustments: [
        { amount: '200.00', direction: 'DEBIT' },
        { amount: '100.00', direction: 'CREDIT' },
      ],
    });
    expect(quote).toEqual({
      units: 2,
      rentalAmount: '2001.00',
      total: '2101.00',
      currency: 'LKR',
    });
    expect(colomboCalendarYear(new Date('2026-12-31T18:30:00.000Z'))).toBe(2027);
  });
});
