import { decimal } from '../modules/bookings/booking-pricing.js';

function sum(values) {
  return values.reduce((total, value) => total.plus(decimal(value)), decimal(0));
}

export function calculateRentalFinancialSummary(record) {
  const charges = (record.charges ?? []).filter((charge) => (
    !charge.voidedAt && charge.approvalStatus !== 'PENDING' && charge.approvalStatus !== 'REJECTED'
  ));
  const rentalCharges = charges.reduce(
    (total, charge) => total.plus(
      decimal(charge.amount).mul(charge.direction === 'CREDIT' ? -1 : 1),
    ),
    decimal(0),
  );
  let rentalReceived = decimal(0);
  let depositCollected = decimal(0);
  let depositRefunded = decimal(0);

  for (const payment of record.payments ?? []) {
    if (payment.status !== 'COMPLETED') continue;
    for (const allocation of payment.allocations ?? []) {
      const amount = decimal(allocation.amount);
      if (allocation.allocationType === 'RENTAL') {
        rentalReceived = rentalReceived.plus(
          amount.mul(payment.direction === 'REFUND' ? -1 : 1),
        );
      } else if (allocation.allocationType === 'SECURITY_DEPOSIT') {
        if (payment.direction === 'REFUND') {
          depositCollected = depositCollected.minus(amount);
          depositRefunded = depositRefunded.plus(amount);
        } else {
          depositCollected = depositCollected.plus(amount);
        }
      }
    }
  }

  const depositApplied = sum((record.depositApplications ?? []).map(({ amount }) => amount));
  const rentalOutstanding = rentalCharges.minus(rentalReceived).minus(depositApplied);
  const depositRequired = decimal(record.securityDepositSnapshot ?? 0);
  const securityDepositOutstanding = depositRequired.minus(depositCollected).greaterThan(0)
    ? depositRequired.minus(depositCollected)
    : decimal(0);
  const remainingDeposit = depositCollected.minus(depositApplied);
  const totalReceived = rentalReceived.plus(depositCollected);
  const paymentStatus = rentalCharges.isZero() && securityDepositOutstanding.isZero()
    ? 'SETTLED'
    : totalReceived.lessThanOrEqualTo(0)
      ? 'UNPAID'
      : rentalOutstanding.lessThanOrEqualTo(0) && securityDepositOutstanding.isZero()
        ? 'SETTLED'
        : 'PARTIAL';

  return {
    currency: record.currency,
    rentalCharges: rentalCharges.toFixed(2),
    rentalReceived: rentalReceived.toFixed(2),
    rentalOutstanding: rentalOutstanding.toFixed(2),
    securityDepositRequired: depositRequired.toFixed(2),
    securityDepositCollected: depositCollected.toFixed(2),
    securityDepositRefunded: depositRefunded.toFixed(2),
    securityDepositApplied: depositApplied.toFixed(2),
    securityDepositHeld: remainingDeposit.toFixed(2),
    remainingDeposit: remainingDeposit.toFixed(2),
    securityDepositOutstanding: securityDepositOutstanding.toFixed(2),
    totalReceived: totalReceived.toFixed(2),
    paymentStatus,
  };
}
