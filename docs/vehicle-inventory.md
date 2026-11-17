# Vehicle inventory and fleet management

**Status:** Implemented in the application source. The Prisma schema has not been migrated or applied to a database.

## Scope and design

The fleet module uses the existing `Vehicle`, `VehicleSpecification`, `VehicleStatusHistory`, `VehicleImage`, `VehicleDocument`, `VehicleRate`, `RentalPackage`, `VehicleAvailabilityBlock`, `Booking`, `MaintenanceJob`, `MaintenanceSchedule`, and `AuditLog` models. It adds `VehicleMileageReading` for traceable odometer updates. Maintenance and booking APIs are not introduced here; the module reads their existing records for vehicle history and availability.

`Vehicle.status` remains the lifecycle value (`ACTIVE`, `INACTIVE`, `RETIRED`). Operational status is derived at read time:

1. Retired, inactive, or archived vehicles are `INACTIVE`.
2. Any active availability block or in-progress/currently scheduled maintenance job covering the current time is `MAINTENANCE`.
3. A handed-over booking is `RENTED`.
4. A confirmed booking whose interval contains the current time is `RESERVED`.
5. Otherwise an active vehicle is `AVAILABLE`.

The date interval is half-open: `pickupAt <= time < returnAt`. Period availability uses `booking.pickupAt < requestedReturn` and `booking.returnAt > requestedPickup`; touching endpoints do not overlap. Only `CONFIRMED` and `HANDED_OVER` bookings block availability. Pending requests do not create a hold. Availability is rechecked and serialized by vehicle in the future booking-confirmation workflow; this module does not confirm bookings.

Rental packages and vehicle rates are separate. A rate is keyed to a vehicle and package and carries LKR currency, rental amount, included mileage, additional-kilometre charge, security deposit, and a half-open effective period. Active rates for the same pair cannot overlap. New rates and edits must be effective in the future; effective rates cannot be edited. Booking pricing snapshots remain the source of historical booking totals.

## Prisma schema delta

The schema changes made for this module are:

- Add `VehicleCategory`, `DriveType`, and `MileageReadingSource` enums.
- Extend vehicle identity and inventory metadata (`vin`, chassis/engine numbers, acquisition date, odometer, descriptions, internal notes), vehicle specification fields (category, body type, drive type, air conditioning, features), and document/image metadata needed for secure uploads and lifecycle handling.
- Add `VehicleMileageReading`, with the vehicle, staff actor, current and previous reading, source, reason, and timestamp.
- Add actual parts and labour cost fields to the existing `MaintenanceJob`.
- Add fleet permissions to the existing permission catalog and role templates.

No separate image/document URL fields are introduced. Database rows keep generated storage keys, MIME type, file size, and SHA-256 metadata. Image content is served through an allowlisted endpoint; vehicle documents are downloadable only through authenticated, permission-checked endpoints. No storage key or filesystem path is returned to the frontend.

### Migration status and safe rollout

No migration has been generated or applied, no database was connected, and no `db push`, reset, or seed was run. Review the current `prisma/schema.prisma` against the approved design and the actual target database before creating a migration. The rollout needs to add the new enums/columns/indexes and mileage-reading table while preserving existing vehicle, booking, maintenance, and financial records. Do not reset a production database. After a reviewed migration is applied in the target environment, regenerate the Prisma client and intentionally synchronize the permission catalog/role templates; the seed resets the built-in system-role grants to the repository templates.

## API surface

The fleet API is mounted at `/api/v1`; existing authentication APIs remain under `/api`.

| Route | Permission / purpose |
|---|---|
| `GET /vehicles` | `vehicles.view` or `vehicles.view.assigned`; paginated search, category/specification/status/expiry/maintenance filters, and date-range availability. Assigned staff see only their active assignments. |
| `POST /vehicles`, `GET /vehicles/:id`, `PATCH /vehicles/:id` | Create, inspect, and edit fleet records. |
| `PATCH /vehicles/:id/status`, `POST /vehicles/:id/archive` | Lifecycle changes and soft-archive, with a reason and audit record. Active/upcoming confirmed bookings prevent retirement or archive. |
| `GET/POST /vehicles/:id/images`, `PUT /vehicles/:id/images/order`, `PATCH/DELETE /vehicles/:id/images/:imageId` | Read images, upload, reorder, publish/unpublish, select the primary image, and archive. Image uploads are limited to JPEG, PNG, and WebP; at most 50 active images per vehicle. |
| `GET /vehicles/:id/images/:imageId/content` | Authenticated staff image access, including unpublished images. |
| `GET/POST /vehicles/:id/documents`, `PATCH/DELETE /vehicles/:id/documents/:documentId`, `GET /vehicles/:id/documents/:documentId/download` | Permission-checked private vehicle document metadata, upload/replacement, archive, and download. Files allow PDF, JPEG, PNG, and WebP. A new document archives the prior active document of the same type. |
| `GET /vehicles/:id/mileage`, `POST /vehicles/:id/mileage`, `POST /vehicles/:id/mileage/corrections` | Append mileage readings; only the separate correction permission may record a lower value. |
| `GET /vehicles/:id/maintenance-history`, `GET /vehicles/:id/booking-history`, `GET /vehicles/:id/audit-history` | Read-only, paginated operational history; each requires its specific backend permission. |
| `GET/POST /rental-packages`, `PATCH /rental-packages/:packageId` | View/manage reusable rental packages. Packages are deactivated, not deleted. |
| `GET/POST /vehicles/:id/rates`, `PATCH /vehicles/:id/rates/:rateId` | View/manage effective-dated vehicle rental rates. Rates are deactivated, not deleted. |
| `GET /public/vehicles/:vehicleId/images/:imageId` | Unauthenticated image delivery for an active vehicle only, and only while the image is explicitly published. |

Every mutating route requires the existing session and CSRF protections plus the module-specific backend permission. The frontend hides unauthorized controls but is not an authorization boundary.

## Upload security and LankaHost deployment

`VEHICLE_STORAGE_ROOT` defaults to `./var/private-uploads`, resolved relative to the backend project root. Uploads use random storage keys, actual file-signature detection, extension/MIME agreement, SHA-256 checksums, configured file-size limits, restrictive file creation permissions, and a private root that is not mounted as a static directory. SVG and arbitrary active content are not accepted. Vehicle documents are sent as attachments with `no-store`; public images must be deliberately published.

Configure these environment values in `.env` or the deployment environment:

| Variable | Default | Meaning |
|---|---:|---|
| `VEHICLE_STORAGE_ROOT` | `./var/private-uploads` | Private upload root; relative paths resolve from the backend project root. |
| `VEHICLE_IMAGE_MAX_BYTES` | `10485760` | Maximum size of each image file. |
| `VEHICLE_DOCUMENT_MAX_BYTES` | `20971520` | Maximum size of each document file. |
| `DOCUMENT_EXPIRY_WARNING_DAYS` | `30` | Expiry warning/filter window. |

For LankaHost, provision persistent private storage or an external private object store before enabling uploads. The default local adapter is suitable for development and persistent-volume deployments only; do not rely on ephemeral container/app storage that is lost on restart or release. Back up uploaded objects together with the database, restrict filesystem and backup access, and serve API traffic only over HTTPS. Public vehicle images are delivered by the application route; do not expose the private root through a web-server alias.

## Operational constraints

- Vehicle update, status, archive, mileage, image-primary, document-replacement, package, and rate changes write audit records in the same Prisma transaction as the database mutation.
- Mileage changes lock the vehicle row and append a reading. Ordinary readings cannot decrease; corrections require a distinct permission and a reason.
- Vehicle lifecycle changes and image primary changes lock the vehicle row. Rate creation serializes on the vehicle and package rows before testing active period overlap.
- Rate creation and updates use a 30-second interactive transaction timeout for higher-latency database connections; audit writes remain in the same transaction.
- Availability reads use half-open booking and block intervals. The future booking-confirmation path must acquire the same vehicle-row lock, then recheck confirmed/handed-over bookings and active availability blocks before committing. A frontend availability result is advisory, never the concurrency control.
- Vehicle and financial history is retained through soft archive/deactivation. Images and documents are metadata-retained when archived; physical object retention and deletion require an explicit retention/backup policy.
- All date-time persistence uses Prisma `DateTime(3)` and JavaScript `Date`, representing UTC instants. Date-only business values use MySQL `DATE`. API date-time filters require an explicit UTC offset; date-only document dates are interpreted in UTC.

## Not included

This module does not create booking confirmation/hold workflows, customer management, maintenance job creation, vehicle handover/return, payment processing, or a production object-store adapter. Those depend on the corresponding separately scoped business modules.
