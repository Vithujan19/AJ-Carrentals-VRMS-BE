# AJ Car Rentals Backend

Staff authentication, access-management and vehicle fleet API for the AJ Car Rentals Vehicle Rental Management System.

## Stack and runtime

- Node.js 22, Express 5, JavaScript ES modules
- MySQL 8 and Prisma ORM
- Cookie-based staff sessions, Argon2id password hashing, Zod request validation

## Local setup

1. Use Node.js 22 and install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and a random `CSRF_SECRET` of at least 32 characters.
3. Generate the Prisma client with `npm run prisma:generate`.
4. Review the migration files and apply them to the intended database with `npx prisma migrate deploy`. The API cannot run until the database schema has been provisioned.
5. After reviewing the seed behavior, initialize the permission catalog and roles with `npm run db:seed`.
6. Create the first administrator through the one-time CLI bootstrap below.
7. Start the API with `npm run dev`.

The seed creates or synchronizes `ADMIN`, `MANAGER`, `MAINTAINER` and their permission links. It creates no staff account. Re-running it restores the built-in role permission templates, so do not run it after administrators customize those templates unless that reset is intended. Its transaction allows up to two minutes for remote database connections.

### First administrator

After provisioning the database and seeding roles, set `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, and `BOOTSTRAP_ADMIN_PASSWORD` in the process environment. The password must be 12-128 characters. Run `npm run bootstrap:admin`, then remove those variables from the environment. The command refuses to proceed if any staff account exists; it does not create a public bootstrap endpoint or log the password.

## Configuration

See `.env.example`. Production requires:

- `NODE_ENV=production`, `COOKIE_SECURE=true`, and a `SESSION_COOKIE_NAME` beginning with `__Host-`.
- A strong `CSRF_SECRET`; never reuse it across environments.
- Exact comma-separated `FRONTEND_ORIGINS`; wildcard CORS is not supported.
- `TRUST_PROXY_HOPS` set only to the verified number of trusted LankaHost reverse proxies.
- SMTP settings are optional for booking notifications. Staff password setup and reset do not send email.
- A persistent private volume for `VEHICLE_STORAGE_ROOT`; the default local storage adapter is not suitable for ephemeral deployment storage. Tune vehicle upload size limits to the hosting plan.

For LankaHost, deploy the API behind HTTPS and preferably expose frontend and API on same-site subdomains (for example `portal.example.lk` and `api.example.lk`). Keep credentialed CORS restricted to the frontend origin. `SameSite=Lax` is the default; unrelated-site hosting may cause browsers to block session cookies and should be avoided or designed with a reviewed proxy topology.

## API surface

Authentication and access-management endpoints remain under `/api`:

| Route | Purpose |
|---|---|
| `/auth/csrf`, `/auth/login`, `/auth/logout`, `/auth/me` | CSRF token, staff sign-in/out and session restoration. |
| `/auth/reset-password`, `/auth/change-password`, `/auth/logout-all` | Set/reset with an administrator-issued token, change a password, and revoke sessions. |
| `/staff` | Permission-protected staff list, creation, profile, status and role management. |
| `/staff/:id/password-token` | Generate or revoke setup/reset tokens; requires `staff.manage`. |
| `/staff/:id/sessions` | List/revoke a staff member's sessions; staff may also inspect/revoke their own. |
| `/staff/:id/vehicle-assignments` | Maintainer vehicle assignment administration and self-view. |
| `/roles`, `/roles/permissions` | Read role/permission catalog. |
| `/roles/:id/permissions` | Update a role's permission links. |
| `/audit-logs` | Filter and page through audit events. |
| `/health`, `/ready` | Liveness and database readiness. |

Vehicle inventory, pricing, booking, and rental-operation endpoints are under `/api/v1`. See [vehicle-inventory.md](./docs/vehicle-inventory.md) and [RENTAL_OPERATIONS.md](./docs/RENTAL_OPERATIONS.md) for module routes, permission requirements, upload security, schema delta, and deployment notes.

Mutating browser requests require the configured allowed `Origin`, an `ajvrms_csrf` cookie, and the matching `X-CSRF-Token` header. The CSRF value is HMAC-signed; the session cookie is HttpOnly and stores only an opaque token whose hash is persisted.

New staff remain pending without a password. An authorized administrator generates
a setup token in Staff, shares it securely, and the staff member enters it at
`/reset-password` to activate the account. For resets, generate a fresh token
for an active account; successful use revokes all existing sessions. Tokens
expire after `PASSWORD_RESET_TTL_SECONDS`, can be revoked, and are shown only
when generated. Legacy email reset tokens are no longer accepted.

Review and apply the `20261116000300_admin_password_tokens` migration to the
intended environment before deploying this code. It was not applied by this
change. Verify backups and migration status first; do not reset a database.

All authorization is enforced by backend permissions. The frontend's permission-based route and navigation visibility are not security controls.

## Database status and migration delta

Migration status depends on the target database; use `npx prisma migrate status` to check it. Review [authentication-rbac.md](./docs/authentication-rbac.md), [vehicle-inventory.md](./docs/vehicle-inventory.md), and [RENTAL_OPERATIONS.md](./docs/RENTAL_OPERATIONS.md) for schema additions and migration considerations. The original database proposal and schema proposal remain preserved in [DATABASE_DESIGN.md](./docs/DATABASE_DESIGN.md) and [schema.proposed.prisma](./prisma/schema.proposed.prisma).

## Validation commands

- `npm run lint`
- `npm test`
- `npm run prisma:validate`
- `npm run prisma:generate`

`prisma:generate` generates local client code only; it does not alter a database. Customer and booking functionality is implemented in application source, including rental handover, return, and financial close-out workflows. Maintenance and expense write workflows remain outside the current implementation.
