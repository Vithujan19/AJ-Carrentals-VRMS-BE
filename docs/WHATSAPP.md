# WhatsApp and booking requests

## Modes
- `WHATSAPP_PROVIDER=click_to_chat` (default): no automatic sending. The customer gets a pre-filled `wa.me` link after submitting a request. `whatsappOpenedAt` only records that the link was opened, never delivery.
- `WHATSAPP_PROVIDER=cloud_api`: on staff confirmation a `WhatsAppMessage` is queued in the same transaction (only with customer consent, not withdrawn, valid number) and sent best effort. Requires `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` and an approved template (`WHATSAPP_CONFIRMATION_TEMPLATE`, default `booking_confirmed`; body params: name, reference, vehicle, pickup). Meta bills per template message/conversation.

## Environment
Backend: `BUSINESS_NAME`, `WHATSAPP_BUSINESS_NUMBER`, `WHATSAPP_DEFAULT_COUNTRY_CODE` plus the cloud variables above (see `.env.example`). Frontend: `VITE_WHATSAPP_NUMBER` (optional header link).

## Webhook
Register `https://<api-host>/api/v1/webhooks/whatsapp` in Meta with the verify token. Payloads are checked with HMAC-SHA256 using the app secret; CSRF is skipped for this path only. Status updates are monotonic (late `sent` never overrides `delivered`).

## Retries
Failed sends requeue with backoff, FAILED after 5 attempts or a non-retryable error. Schedule `npm run whatsapp:process` (cron, every few minutes). Staff with `whatsapp.manage` can retry from the booking page.

## Idempotency
`POST /api/v1/public/booking-requests` requires an `Idempotency-Key` header. Same key and body replays the stored response (200); same key with a different body gives 422; in-progress gives 409. Keys expire after 24 hours. The stored response includes the customer lookup token (accepted trade-off).

## Deployment
1. `npx prisma migrate deploy` (migrations `20261118000100`, `20261118000200`).
2. `npm run db:seed` (adds `vehicles.publish`, `whatsapp.manage`).
3. Deploy and restart backend and frontend; set the new env vars.

## Not verified
No end-to-end run against a real database was done (the configured database is production). Run one against a disposable database before release.
