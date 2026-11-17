import { colomboCalendarYear } from './booking-pricing.js';
import { AppError } from '../../shared/errors.js';

export async function allocateBookingReference(tx, createdAt = new Date()) {
  const year = colomboCalendarYear(createdAt);
  await tx.$executeRaw`
    INSERT INTO BookingReferenceCounter (year, lastSequence, updatedAt)
    VALUES (${year}, 0, NOW(3))
    ON DUPLICATE KEY UPDATE lastSequence = lastSequence
  `;
  const [counter] = await tx.$queryRaw`
    SELECT lastSequence
    FROM BookingReferenceCounter
    WHERE year = ${year}
    FOR UPDATE
  `;
  if (!counter) {
    throw new Error('Booking reference counter could not be locked.');
  }
  const sequence = Number(counter.lastSequence) + 1;
  if (sequence > 4_294_967_295) {
    throw new AppError(409, 'BOOKING_REFERENCE_SEQUENCE_EXHAUSTED', 'The booking reference sequence is exhausted for this year.');
  }
  await tx.bookingReferenceCounter.update({
    where: { year },
    data: { lastSequence: sequence },
  });
  return {
    year,
    sequence,
    reference: `AJR-${year}-${String(sequence).padStart(6, '0')}`,
  };
}
