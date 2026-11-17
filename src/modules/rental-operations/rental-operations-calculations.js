import { decimal } from '../bookings/booking-pricing.js';

export function calculateExcessMileage(distanceTravelledKm, includedMileageKm) {
  return Math.max(0, distanceTravelledKm - includedMileageKm);
}

export function calculateLateReturnCharge({
  scheduledReturnAt,
  actualReturnAt,
  graceMinutes,
  ratePerHour,
  billingIncrementMinutes,
}) {
  if (!ratePerHour || !billingIncrementMinutes) return null;
  const lateMinutes = Math.floor((actualReturnAt.getTime() - scheduledReturnAt.getTime()) / 60_000);
  const chargeableMinutes = lateMinutes - graceMinutes;
  if (chargeableMinutes <= 0) return null;

  const units = Math.ceil(chargeableMinutes / billingIncrementMinutes);
  const amount = decimal(ratePerHour).mul(units).mul(billingIncrementMinutes).div(60);
  return {
    units,
    amount: amount.toDecimalPlaces(2).toFixed(2),
    unitPrice: decimal(ratePerHour).mul(billingIncrementMinutes).div(60).toDecimalPlaces(2).toFixed(2),
    chargeableMinutes,
  };
}

export function allocationTotal(allocations) {
  return allocations.reduce(
    (total, allocation) => total.plus(decimal(allocation.amount)),
    decimal(0),
  );
}
