# Rental operations

**Status:** Implemented in application source. The Prisma schema has not been migrated or applied to a database.

## Workflow

Rental operations are a guided, auditable workflow for confirmed bookings:

1. Staff record customer verification. The latest review must be `VERIFIED` before a handover. Configured document requirements and driving-licence checks are enforced at verification and again at handover.
2. Staff start and save a versioned handover draft with actual time, odometer, fuel, configured accessories, inspection results, and private photographs. Completion requires customer acknowledgement and rechecks booking status, permissions, policy requirements, and draft version.
3. Staff record a versioned return draft with mileage, fuel, accessory return quantities, inspection, damage, and optional maintenance-needed details. Completion records vehicle availability restrictions and may propose excess-mileage or late-return charges only when the corresponding booking rate or explicit system setting exists.
4. Damage and proposed charges remain pending until an authorized user approves or rejects them. Fuel differences do not create an assumed fee.
5. Staff record cash, bank-transfer, or card transactions manually, including multiple partial collections and refunds. The system does not call an online payment gateway.
6. Authorized staff apply a held security deposit against an approved debit charge, refund any remaining deposit, and finalize a returned rental after pending decisions and financial close-out requirements are satisfied.

Draft updates use optimistic versions. Completion and financial mutations run in a database transaction while locking the vehicle and booking rows. Important changes also write audit records within that transaction. Completed rentals cannot be changed through the rental-operation financial workflows.

## Schema delta

The schema additions for this module include:

- Rental operation, verification, inspection, damage, charge-decision, payment-direction, payment-allocation, and maintenance enums.
- `RentalHandover`, `RentalReturn`, `RentalInspection`, `RentalInspectionItem`, `InspectionPhoto`, `DamageReport`, `DamageImage`, `DamageApproval`, and `DamageResolution`.
- `RentalCustomerVerification`, `RentalOperationDraft`, `RentalOperationDraftPhoto`, and `RentalFinalization`.
- Extensions to `BookingCharge`, `Payment`, `PaymentAllocation`, and `DepositApplication` for idempotency, approvals, refunds, receipt metadata, deposit applications, and financial snapshots. In particular, the current schema adds `DepositApplication.idempotencyKey`.
- Rental-operation permissions in the backend catalog and role templates. The manager template includes review and finance operations; the maintainer template is limited to assigned vehicle operations and inspections.

No separate public document URLs or file paths are exposed. Database records retain generated storage keys and file metadata; content is returned only through authenticated, permission-checked endpoints. NIC/licence ciphertext is not returned by the rental-operation detail API. Staff verify identity from the private customer-document workflow rather than receiving decrypted values in this API.

## API surface

All routes below are mounted under `/api/v1/rental-operations`. They require an authenticated staff session and the listed backend permission. Assigned staff are restricted to bookings for vehicles currently assigned to them.

| Route | Purpose |
|---|---|
| `GET /dashboard` | Active, due-today, overdue, or upcoming booking queues; requires a rental-operation view permission. |
| `GET /policy`, `PUT /policy` | Read or manage required verification documents, inspection/accessory checklists, deposit/finalization rules, and explicit late-return rate configuration. |
| `GET /bookings/:bookingId` | Rental-operation detail with permission-filtered customer and financial data. |
| `POST /bookings/:bookingId/customer-verification` | Record an idempotent customer verification review. |
| `GET/POST/PATCH /bookings/:bookingId/:operation/draft` | Read, start, or update a versioned handover/return draft. |
| `POST /bookings/:bookingId/:operation/draft/photos` | Upload private inspection photographs to a draft. |
| `POST /bookings/:bookingId/:operation/complete` | Complete a handover or return after server-side validation and acknowledgement. |
| `POST /bookings/:bookingId/damages`, `GET /damages` | Record damage and browse the permission-filtered damage queue. |
| `POST /damages/:damageId/decision`, `POST /damages/:damageId/images` | Decide damage chargeability and attach private damage evidence. |
| `POST /bookings/:bookingId/charges`, `POST /charges/:chargeId/decision` | Propose and approve/reject booking charges. |
| `GET /bookings/:bookingId/financial-summary` | Read current rental, payment, and deposit totals. |
| `POST /bookings/:bookingId/payments` | Record a manual payment with allocations summing exactly to its amount. |
| `POST /bookings/:bookingId/payments/:paymentId/refunds` | Record a refund against the original payment and allocation limits. |
| `POST /bookings/:bookingId/payments/:paymentId/corrections` | Correct a payment using the explicit correction permission and reason. |
| `POST /bookings/:bookingId/payments/:paymentId/receipts` | Upload private receipt evidence. |
| `POST /bookings/:bookingId/deposit-applications` | Apply an available held deposit against an approved debit charge. |
| `POST /bookings/:bookingId/finalize` | Close out a returned rental and snapshot its financial position. |
| `GET /customers/:customerId/documents` and document download route | View or download private customer documents with `customers.documents.view`. |

Legacy one-shot booking handover, return, and completion routes have been removed. Booking status changes for operations must use the guided workflow.

## Financial and operational rules

- Money is calculated with Prisma Decimal values. Payment allocations must equal the recorded transaction amount; collection/refund amounts are checked against current balances and the original transaction.
- Financial summaries count only non-voided, approved charges and completed payments. Rental and security-deposit allocations are tracked separately; `OTHER` allocations are retained but are not included in rental/deposit totals.
- Deposit application is constrained by the held deposit, rental outstanding balance, and the remaining amount on the approved charge.
- Finalization blocks while charges or new-damage decisions are pending, while a security deposit remains held, or while an outstanding rental balance exists unless the system policy explicitly permits it. A rental credit must be resolved before finalization.
- Excess mileage uses the booking's mileage and rate snapshots. Late-return charges use the explicit policy rate and billing increment together with the booking's grace period. Both create pending proposals rather than immediately recognized charges.
- No charge is inferred for fuel differences, unconfigured late returns, or undocumented policy.

## Files and LankaHost deployment

Operation photographs, damage images, and payment receipts reuse the configured private `VEHICLE_STORAGE_ROOT`. Uploads are signature-checked by the shared vehicle upload inspection, limited by existing image/document size settings, stored under generated keys, and delivered through permission-checked endpoints with private/no-store response headers. Do not mount this directory as a static or public web directory.

For LankaHost, the storage root must be a persistent private volume or a reviewed private object-storage adapter. Back up files together with their database metadata, restrict access to the application and authorized backup processes, and confirm persistence across app releases/restarts. Keep the frontend and API on HTTPS and same-site origins where practical; retain the existing exact-origin CORS and secure cookie configuration.

## Migration and rollout

No database connection, Prisma migration, `db push`, reset, or production data operation was performed. Before deployment:

1. Review `prisma/schema.prisma` against the approved design and target database.
2. Generate and review a migration that creates the rental-operation tables/enums and applies the related existing-model changes, including `DepositApplication.idempotencyKey`.
3. Apply the reviewed migration through the deployment's normal backup and rollback process; never reset a production database.
4. Regenerate Prisma Client and intentionally synchronize permission catalog/role templates. Running the seed restores built-in role-template grants.
5. Review the initial `rental_operations_policy` values with the business owner. The defaults do not require specific documents, a security deposit before handover, or an automatic late-return rate.
6. Test private file persistence, restore procedures, authorization, duplicate-request behavior, and financial reports in a non-production environment.

The application currently does not decrypt NIC/licence ciphertext for display in this workflow. If a legal or operational requirement calls for staff to inspect these values directly, approve a separate encryption-key management and access/audit design first.
