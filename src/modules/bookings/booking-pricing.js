import { Prisma } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;
const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function colomboParts(date) {
  const local = new Date(date.getTime() + COLOMBO_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
    millisecond: local.getUTCMilliseconds(),
  };
}

export function addColomboCalendarMonths(date, months) {
  const parts = colomboParts(date);
  const targetMonthIndex = parts.year * 12 + parts.month + months;
  const year = Math.floor(targetMonthIndex / 12);
  const month = targetMonthIndex % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(parts.day, lastDay);
  return new Date(
    Date.UTC(
      year,
      month,
      day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
    ) - COLOMBO_OFFSET_MS,
  );
}

export function billableRentalUnits(pickupAt, returnAt, rentalPackage) {
  const durationMs = returnAt.getTime() - pickupAt.getTime();
  if (durationMs <= 0) {
    throw new RangeError('Return must be later than pickup.');
  }
  if (!Number.isInteger(rentalPackage.durationCount) || rentalPackage.durationCount < 1) {
    throw new RangeError('Rental package duration must be a positive integer.');
  }

  if (rentalPackage.rentalPeriod === 'DAILY' || rentalPackage.rentalPeriod === 'WEEKLY') {
    const daysPerUnit = rentalPackage.durationCount *
      (rentalPackage.rentalPeriod === 'WEEKLY' ? 7 : 1);
    return Math.ceil(durationMs / (daysPerUnit * DAY_MS));
  }

  if (rentalPackage.rentalPeriod !== 'MONTHLY') {
    throw new RangeError('Rental package period is not supported.');
  }

  const start = colomboParts(pickupAt);
  const end = colomboParts(returnAt);
  const monthDifference = Math.max(0, (end.year - start.year) * 12 + end.month - start.month);
  let units = Math.max(1, Math.ceil(monthDifference / rentalPackage.durationCount));
  while (addColomboCalendarMonths(pickupAt, units * rentalPackage.durationCount) < returnAt) {
    units += 1;
  }
  while (
    units > 1 &&
    addColomboCalendarMonths(pickupAt, (units - 1) * rentalPackage.durationCount) >= returnAt
  ) {
    units -= 1;
  }
  return units;
}

export function decimal(value) {
  return new Prisma.Decimal(value);
}

export function priceQuote({ rate, rentalPackage, pickupAt, returnAt, adjustments = [] }) {
  const units = billableRentalUnits(pickupAt, returnAt, rentalPackage);
  const rentalAmount = decimal(rate.rentalPrice).mul(units);
  const adjustmentsTotal = adjustments.reduce(
    (total, adjustment) => total.plus(decimal(adjustment.amount).mul(
      adjustment.direction === 'CREDIT' ? -1 : 1,
    )),
    decimal(0),
  );
  const total = rentalAmount.plus(adjustmentsTotal);
  if (total.lessThan(0)) {
    throw new RangeError('Booking adjustments cannot reduce the rental amount below zero.');
  }
  return {
    units,
    rentalAmount: rentalAmount.toFixed(2),
    total: total.toFixed(2),
    currency: rate.currency,
  };
}

export function colomboCalendarYear(date) {
  return colomboParts(date).year;
}
