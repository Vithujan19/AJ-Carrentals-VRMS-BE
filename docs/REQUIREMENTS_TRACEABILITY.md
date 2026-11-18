# Public sharing, booking journey and WhatsApp: traceability

Status of the staged enhancement. "Verified" means covered by an automated test or a successful build; nothing here has been deployed.

| Requirement | Status | Where | Verification |
| --- | --- | --- | --- |
| Public sharing reuses `Vehicle.isPublished`, ACTIVE vehicles only | Done | `vehicle.service.js` (`setPublication`), `PATCH /api/v1/vehicles/:id/publication` | `test/vehicle-service.test.js` |
| `vehicles.publish` permission, audited (`vehicle.published`/`vehicle.unpublished`) | Done | `permissions.js`, `vehicle.routes.js` | `test/vehicle-service.test.js` |
| Staff preview of the public page | Done | `GET /api/v1/vehicles/:id/public-preview` | Manual |
| Public catalogue and detail (`/fleet`, `/fleet/:id`) | Done | `GET /api/v1/public/vehicles[/:id]` | Frontend test and build |
| Public booking request, pending until staff confirm | Existing | `POST /api/v1/public/booking-requests` | `test/public-booking-privacy.test.js` |
| Overlapping confirmed bookings prevented, concurrently safe | Existing | `booking.service.js` (`confirm`, row lock) | `test/booking-confirmation.test.js` |
| Staff approve, reject, review (request info) | Existing | `/api/v1/bookings/:id/confirm|reject|review` | `test/booking-confirmation.test.js` |
| Brand redesign (logo, `cover1`/`car-br` imagery, `#ed1e24` red/black/white) | Done | `PublicLayout.jsx`, `PublicHomePage.jsx`, `styles.css` | Frontend build |
| Four-hour staff session default | Done | `src/config/env.js` | `test/session-lifetime.test.js` |
| Per-vehicle public availability calendar | **Done** | `GET /public/vehicles/:id/calendar`, `AvailabilityCalendar.jsx` | `public-booking-privacy.test.js` |
| Idempotency key and rate limits on booking request | **Done** | `shared/idempotency.js`, `POST /public/booking-requests` | `whatsapp.test.js` |
| Booking consent fields, `whatsappOpenedAt` | **Done** | booking service, opened/revoke routes | `public-booking-privacy.test.js` |
| WhatsApp click-to-chat on confirmation page | **Done** | `whatsapp.link.js`, `PublicBookingPage.jsx` | `whatsapp.test.js` |
| `WhatsAppMessage` outbox, provider abstraction, webhook, retry | **Done** (automatic sending needs Meta setup, see WHATSAPP.md) | `modules/whatsapp/` | `whatsapp.test.js` |
| Staff pending-queue dashboard and per-role dashboards | **Done** | `DashboardPage.jsx`, `BookingsPage.jsx?status=`, WhatsApp panel on `BookingDetailPage.jsx` | build only |
| End-to-end test against a real database | **Not run** | See below | |

## Why there is no real-database end-to-end test

The backend `.env` points at the hosted production database. Tests in this repository therefore use mocked Prisma clients. Run an end-to-end flow (publish, list, request, confirm, duplicate and overlap rejection, unpublish) only against a disposable MySQL database created for that purpose.

## Deployment checklist

1. Apply migrations `20261118000100_vehicle_published_at` and `20261118000200_whatsapp_and_idempotency` with `prisma migrate deploy`.
2. Run `npm run db:seed` so ADMIN and MANAGER receive `vehicles.publish`.
3. Deploy the backend and frontend, then restart the backend.
4. Optionally set `VITE_WHATSAPP_NUMBER` (digits only, with country code) at frontend build time to show the WhatsApp link in the public header.
5. Confirm hosting variables do not override `SESSION_TTL_SECONDS` / `SESSION_IDLE_TTL_SECONDS`.
