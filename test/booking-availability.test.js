import { describe, expect, it } from 'vitest';
import {
  blockingAvailabilityBlockWhere,
  blockingBookingWhere,
  blockingMaintenanceWhere,
  dateAvailabilityWhere,
} from '../src/shared/vehicle-availability.js';

describe('booking availability predicates', () => {
  const from = new Date('2027-01-01T04:30:00.000Z');
  const to = new Date('2027-01-05T04:30:00.000Z');

  it('uses half-open overlap rules and only confirmed or unreturned handed-over rentals', () => {
    const where = blockingBookingWhere(from, to);
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0]).toEqual({
      status: 'CONFIRMED',
      pickupAt: { lt: to },
      returnAt: { gt: from },
    });
    expect(where.OR[1]).toMatchObject({
      status: 'HANDED_OVER',
      OR: [
        { handover: { is: null }, pickupAt: { lt: to } },
        {
          handover: {
            is: {
              handedOverAt: { lt: to },
              return: { is: null },
            },
          },
        },
      ],
    });
  });

  it('keeps pending requests out of blockers and prevents availability-block/maintenance overlap', () => {
    const where = dateAvailabilityWhere(from, to);
    expect(where.AND[0].bookings.none.OR.map(({ status }) => status))
      .toEqual(['CONFIRMED', 'HANDED_OVER']);
    expect(blockingAvailabilityBlockWhere(from, to)).toEqual({
      status: 'ACTIVE',
      startsAt: { lt: to },
      OR: [{ endsAt: null }, { endsAt: { gt: from } }],
    });
    expect(blockingMaintenanceWhere(from, to).OR).toHaveLength(2);
  });
});
