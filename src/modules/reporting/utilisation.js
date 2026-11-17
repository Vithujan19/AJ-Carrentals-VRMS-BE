import { decimal } from '../bookings/booking-pricing.js';

function time(value) {
  const result = value instanceof Date ? value.getTime() : NaN;
  if (!Number.isFinite(result)) throw new RangeError('Interval boundaries must be valid dates.');
  return result;
}

function normalize(intervals, start, end) {
  const ranges = intervals.map((interval) => {
    const from = time(interval.start);
    const to = time(interval.end);
    if (to < from) throw new RangeError('An interval cannot end before it starts.');
    return [Math.max(start, from), Math.min(end, to)];
  }).filter(([from, to]) => from < to).sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [from, to] of ranges) {
    const last = merged.at(-1);
    if (last && from <= last[1]) {
      last[1] = Math.max(last[1], to);
    } else {
      merged.push([from, to]);
    }
  }
  return merged;
}

function intersect(left, right) {
  const result = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i][0], right[j][0]);
    const end = Math.min(left[i][1], right[j][1]);
    if (start < end) result.push([start, end]);
    if (left[i][1] <= right[j][1]) i += 1;
    else j += 1;
  }
  return result;
}

function duration(intervals) {
  return intervals.reduce((total, [start, end]) => total + end - start, 0);
}

export function calculateUtilisation({ period, active, rentals, maintenance }) {
  const start = time(period.start);
  const end = time(period.end);
  if (end <= start) throw new RangeError('The reporting period must have a positive duration.');

  const activeRanges = normalize(active, start, end);
  const rentalRanges = intersect(activeRanges, normalize(rentals, start, end));
  const maintenanceRanges = intersect(activeRanges, normalize(maintenance, start, end));
  const overlappingRentalMaintenance = intersect(rentalRanges, maintenanceRanges);
  const rentalMs = duration(rentalRanges);
  const maintenanceDowntimeMs = duration(maintenanceRanges) - duration(overlappingRentalMaintenance);
  const eligibleMs = duration(activeRanges) - maintenanceDowntimeMs;

  return {
    rentalMs,
    eligibleMs,
    maintenanceDowntimeMs,
    utilisationPercent: eligibleMs === 0
      ? null
      : decimal(rentalMs).mul(100).div(eligibleMs).toFixed(2),
  };
}
