import { describe, expect, it, vi } from 'vitest';
import { allocateBookingReference } from '../src/modules/bookings/booking-reference.js';

describe('transactional booking reference allocation', () => {
  it('uses the Colombo creation year and fixed AJR reference format', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{ lastSequence: 0 }]),
      bookingReferenceCounter: { update: vi.fn().mockResolvedValue({}) },
    };
    const reference = await allocateBookingReference(tx, new Date('2026-12-31T18:30:00.000Z'));

    expect(reference).toEqual({
      year: 2027,
      sequence: 1,
      reference: 'AJR-2027-000001',
    });
    expect(tx.bookingReferenceCounter.update).toHaveBeenCalledWith({
      where: { year: 2027 },
      data: { lastSequence: 1 },
    });
  });

  it('allocates distinct increasing references when concurrent callers lock the counter row', async () => {
    let lastSequence = 0;
    let queue = Promise.resolve();
    const nextReference = async () => {
      let release;
      const tx = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        $queryRaw: vi.fn(async () => {
          const previous = queue;
          queue = new Promise((resolve) => { release = resolve; });
          await previous;
          return [{ lastSequence }];
        }),
        bookingReferenceCounter: {
          update: vi.fn(async ({ data }) => {
            lastSequence = data.lastSequence;
          }),
        },
      };
      try {
        return await allocateBookingReference(tx, new Date('2026-11-15T12:00:00.000Z'));
      } finally {
        release();
      }
    };

    const references = await Promise.all([nextReference(), nextReference(), nextReference()]);
    expect(references.map(({ reference }) => reference)).toEqual([
      'AJR-2026-000001',
      'AJR-2026-000002',
      'AJR-2026-000003',
    ]);
  });
});
