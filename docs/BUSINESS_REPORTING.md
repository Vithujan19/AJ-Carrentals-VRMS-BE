# Business reporting: design and implementation status

**Status: not implemented.** There are no reporting APIs, dashboards or exports.
The shared utilisation interval calculation has focused unit tests, but it is
not yet connected to database records or an API.

## Approved business definitions

- Recognize approved rental charges on the rental finalization date. Exclude
  booking quotations, unapproved or voided charges and refundable deposits.
- Include approved operating expenses by recorded expense date, independently
  of when payment occurs. Approved expenses and actual cash paid are different
  metrics. Only approved expense records are the source of operating costs;
  maintenance job cost fields are not an additional expense.
- For vehicle utilisation, actual rental time takes precedence where it overlaps
  maintenance. Use half-open intervals `[start, end)` and merge overlapping
  intervals so time is never counted twice. Subtract maintenance downtime only
  where the vehicle was not rented; exclude inactive periods.
- Use an external cron for reminders, with idempotent event keys and explicit
  provider-failure handling.

## Intended metric sources

| Metric | Source and period |
|---|---|
| Earned revenue | Approved, non-voided booking charges for finalized rentals, grouped by `RentalFinalization.finalizedAt`; debit less credit. |
| Collections and refunds | Completed payment allocations grouped separately by direction and `Payment.transactionAt`; security-deposit allocations remain separate from rental collections. |
| Receivables | Rental charges less rental allocations and deposit applications, with refund and correction effects; report as of a clearly specified cutoff. |
| Operating expenses | Approved expenses grouped by `Expense.expenseDate`; maintenance-linked costs appear once. |
| Paid expenses | Expense payment records, once added, grouped by actual payment date; approval does not imply payment. |
| Vehicle contribution | Recognized vehicle rental revenue less approved expenses assigned to that vehicle. |
| Utilisation | Union of actual handover-to-return intervals divided by eligible active time after non-rented maintenance downtime. |

Financial amounts must use Decimal arithmetic and a consistent currency; mixed
currencies must not be summed without an approved exchange-rate policy.
Date-range filters should use Colombo calendar boundaries converted to UTC,
with inclusive start and exclusive end. Dashboards, details and exports must
share the same query and calculation definitions.

## Gaps to resolve before release

- Expense payments and recurring schedules are not represented in the current
  schema. Add transaction history rather than treating an expense's payment
  method as a payment.
- Historical financial reports need explicit as-of treatment of payment
  corrections and expense approval, rejection or cancellation. Current status
  alone cannot reconstruct every historical state; use existing history where
  sufficient and extend it where necessary.
- Availability block history and vehicle status history must be reconstructed
  carefully for past periods. Missing historical data must be reported as a
  limitation, not silently assumed to mean available.
- Date-only and open rental intervals need explicit reporting cutoffs. Rental
  and maintenance overlap, zero eligible time, inactive periods, and fleet
  aggregation must be tested against real records.
- Financial reports and exports require backend RBAC, paginated drill-down,
  reconciliation, and MySQL integration testing before production use.
