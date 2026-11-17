export function findActiveRentalPolicy(tx, now) {
  return tx.rentalPolicy.findFirst({
    where: {
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
}
