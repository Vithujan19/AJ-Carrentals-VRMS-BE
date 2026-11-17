import { describe, expect, it } from 'vitest';
import { calculateUtilisation } from '../src/modules/reporting/utilisation.js';

const hour = (value) => new Date(Date.UTC(2027, 0, 1, value));
const range = (start, end) => ({ start: hour(start), end: hour(end) });
const HOUR = 60 * 60 * 1000;

describe('vehicle utilisation', () => {
  it('clips and merges overlapping rentals and gives rentals priority over maintenance', () => {
    expect(calculateUtilisation({
      period: range(0, 10),
      active: [range(0, 10)],
      rentals: [range(1, 4), range(3, 6), range(9, 12)],
      maintenance: [range(5, 8), range(7, 9)],
    })).toEqual({
      rentalMs: 6 * HOUR,
      eligibleMs: 7 * HOUR,
      maintenanceDowntimeMs: 3 * HOUR,
      utilisationPercent: '85.71',
    });
  });

  it('excludes inactive time and counts overlapping downtime only once', () => {
    expect(calculateUtilisation({
      period: range(0, 12),
      active: [range(2, 6), range(8, 10)],
      rentals: [range(0, 3), range(5, 9)],
      maintenance: [range(3, 5), range(4, 8)],
    })).toEqual({
      rentalMs: 3 * HOUR,
      eligibleMs: 4 * HOUR,
      maintenanceDowntimeMs: 2 * HOUR,
      utilisationPercent: '75.00',
    });
  });

  it('returns no percentage when no time is eligible', () => {
    expect(calculateUtilisation({
      period: range(0, 1),
      active: [range(0, 1)],
      rentals: [],
      maintenance: [range(0, 1)],
    }).utilisationPercent).toBeNull();
  });

  it('rejects reversed intervals instead of producing misleading figures', () => {
    expect(() => calculateUtilisation({
      period: range(0, 2),
      active: [range(2, 1)],
      rentals: [],
      maintenance: [],
    })).toThrow(RangeError);
  });
});
