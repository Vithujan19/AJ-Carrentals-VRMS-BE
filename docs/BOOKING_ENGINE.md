# Booking engine and availability

This module provides staff booking management, a public booking-request flow,
date-based availability, booking lifecycle actions, and vehicle handover/return
records. It reuses the existing Prisma booking, customer, pricing, payment,
availability-block, maintenance, audit, and rental-operation models.

## Booking lifecycle

| Status | Blocks availability | Allowed next states |
| --- | --- | --- |
| `PENDING` | No | `UNDER_REVIEW`, `CONFIRMED`, `REJECTED`, `CANCELLED`, `EXPIRED` |
| `UNDER_REVIEW` | No | `CONFIRMED`, `REJECTED`, `CANCELLED`, `EXPIRED` |
| `CONFIRMED` | Yes, for its scheduled interval | `CANCELLED`, `NO_SHOW`, `HANDED_OVER` |
| `HANDED_OVER` | Yes, until a return record exists | `RETURNED` |
| `RETURNED` | No | `COMPLETED` |
| `REJECTED`, `CANCELLED`, `EXPIRED`, `NO_SHOW`, `COMPLETED` | No | Terminal |

Pending public requests do not reserve a vehicle. Confirmation rechecks
availability. Cancellation requires a reason, releases the interval, and does
not automatically assess fees or issue refunds. Expiry is a staff action; no
automated expiry schedule is configured.

Availability intervals are half-open: pickup time is inclusive and return time
is exclusive. A conflict exists when `existing.pickupAt < requested.returnAt`
and `existing.returnAt > requested.pickupAt`. Active availability blocks and
blocking maintenance intervals use the same overlap convention. An active
handed-over rental with no return record has no effective end and continues to
block future availability from its recorded handover time.

## Transaction and concurrency protection

Booking creation, edits that affect availability, confirmation, handover, and
return lock the affected `Vehicle` row with MySQL `SELECT ... FOR UPDATE`.
Transactions then re-read the booking and availability conditions before
writing. Vehicle locks are acquired in sorted ID order when an edit moves a
booking, avoiding inconsistent lock ordering. Prisma `P2034` conflicts receive
up to three bounded transaction attempts.

This serializes competing booking changes for the same vehicle, including
simultaneous confirmations. It depends on MySQL/InnoDB and the table names
generated from the current Prisma schema. A MySQL integration test should be
run against the deployment database configuration before production rollout;
the automated concurrency test uses a serialized lock mock and is not a
substitute for that integration test.

Booking references use a per-year `BookingReferenceCounter` row locked in the
same transaction. The year is derived in `Asia/Colombo`; references use
`AJR-YYYY-NNNNNN` and expand beyond six digits if necessary.

## Pricing and balance semantics

The approved quote policy bills whole rental-package periods:

- Daily periods are 24-hour units.
- Weekly periods are seven-day units.
- Monthly periods are Colombo calendar months, with month-end clamping (for
  example, January 31 to February 28 is one month in a non-leap year).
- Partial package periods round up to a whole unit.
- Pricing rules are not applied automatically. Manual debit/discount lines
  require the pricing-adjustment permission.
- Monetary calculations use Prisma `Decimal`. The security deposit is stored
  as a snapshot and is excluded from the rental quote.

The booking retains snapshots of the package, rate, mileage allowance,
additional-kilometre rate, security deposit, terms, customer, and vehicle
registration. Rate changes therefore do not rewrite historical bookings.

The financial summary reads completed payments and their allocations, refunds,
booking charge lines, and deposit applications. Rental charges are net of
credits and voided lines; payment amounts are net of refunds. The rental and
deposit balances are shown separately. This module does not create payments,
refunds, or deposit applications, and it does not integrate an online payment
gateway.

## Timezone strategy

API date-time values must include an explicit UTC offset. JavaScript `Date`
values are persisted through MySQL `DATETIME(3)` using UTC application values;
the database column itself has no timezone metadata. User-facing calendar
inputs and monthly-package boundaries use `Asia/Colombo`. Keep database and
server session timezone configuration consistent with UTC, and format
customer/staff times in Colombo at the presentation boundary.

## Authorization and public lookup

All staff routes require backend authentication and their explicit permission.
Assigned-vehicle users are scoped to active assignments in list, calendar,
availability, and booking reads; mutation paths recheck assignment inside the
transaction. Customer fields, financial details, internal notes, status
reasons, staff identifiers, and handover/return details are returned only to
callers with the corresponding permissions.

The public website can search active vehicles with active rates and submit a
pending request. It receives a random 256-bit lookup token once; only its
SHA-256 hash is stored. Status lookup requires both the reference and token in
a POST body, and the token is not included in URLs. Configure HTTPS in
production. Optional SMTP delivery can send the token and request/status
notifications. Public endpoint rate limits use the in-memory Express limiter;
multi-instance deployments need a shared rate-limit store or equivalent
edge-level protection.

## Schema and rollout notes

The booking implementation adds these fields to the existing `Booking` model:

- `publicLookupTokenHash`: nullable unique SHA-256 token hash.
- `pickupLocationSnapshot` and `returnLocationSnapshot`: nullable location
  snapshots.

Review the schema delta and generate a migration only after the migration
baseline/history has been established. No migration, database connection,
seed, or production data operation was performed as part of this implementation.
Do not use a schema reset against production.

The existing handover/return records and inspection summaries are reused.
This module does not yet provide inspection-photo upload, customer
acknowledgement capture, payment-entry/refund workflows, or automated booking
expiry. Those require separately designed workflows and permissions.
