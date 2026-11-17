# Maintenance and expenses: design and implementation status

**Status: not implemented.** The current schema contains maintenance and expense
models, but no maintenance or expense management API or interface. No migration
has been generated for these modules.

## Existing records and gaps

- `MaintenanceCategory`, `MaintenanceJob`, `MaintenanceSchedule` and
  `MaintenanceDocument` already exist. Jobs include vehicle, category, dates,
  odometer and parts/labour costs. They lack the full requested workflow,
  assignment, reference, priority, actor and cost fields.
- Schedules support day and kilometre intervals; calendar-month intervals,
  last-service history, reminder thresholds and associated notifications need
  explicit design. Advancing a schedule must occur transactionally only when
  its linked job is completed.
- `VehicleAvailabilityBlock` links to a maintenance job, and the existing
  availability engine also checks scheduled/in-progress jobs. New maintenance
  writes must lock the vehicle row and recheck booking conflicts using the same
  locking protocol as booking confirmation. Completion must not clear unrelated
  blocks or automatically make the vehicle available.
- `ExpenseCategory`, `Expense`, `ExpenseApprovalHistory` and `ExpenseDocument`
  exist. `Expense` has approval status and a payment method, but no payment
  transactions, payment date, recurrence record or booking link. An approval
  alone must never be treated as evidence of payment.
- Maintenance jobs can already have multiple linked expenses. Approved expense
  records are the proposed sole operating-cost source; job estimates and actual
  cost fields are operational context and must not be added again to reports.
- Recurring expense schedules need an immutable occurrence identity and a unique
  schedule/period constraint so concurrent runs cannot create duplicates.
  Reminders must not imply that an expense was paid.
- Existing vehicle documents are private and retained on renewal. Document
  expiry and blocking policies must be configured rather than inferred.

## Reminders and deployment

The approved deployment approach is an external LankaHost cron invoking a
dedicated command. An idempotent notification key per recipient, subject,
event and reminder period is needed before implementing concurrent-safe
reminders. In-app notification records already exist, but there is no general
scheduled notification service or in-app notification API. Provider delivery
failures must be logged separately without rolling back business operations.

## Safety and rollout

Management endpoints must enforce backend permissions and assigned-vehicle
scope, protect private uploads, retain history, and audit consequential
transactions. Database changes require a reviewed Prisma migration; none has
been generated or applied for this work. Do not reset a database. Do not run
production migrations without the deployment review and backup process.
