# Authentication and RBAC implementation notes

**Status:** Administrator-controlled password tokens are implemented in source.
The corresponding migration must be reviewed and applied to each target database.

## Scope

The backend implements staff login, revocable database sessions, password setup/reset/change, account lockout, permission-based staff and role administration, staff vehicle assignments, and audit-log reading. The frontend provides the staff login and token-entry experience and permission-aware staff, role, session, and audit screens.

## Migration delta from the approved proposal

Keep the approved entity model and add only these reviewed changes to its existing tables:

| Table | Change | Reason |
|---|---|---|
| `StaffUser` | Nullable `mobileNumber VARCHAR(32)`; `failedLoginCount INT UNSIGNED NOT NULL DEFAULT 0`; nullable `lastFailedLoginAt DATETIME(3)`. | Staff contact and persisted login-attempt throttling. |
| `StaffPasswordResetToken` | Unique SHA-256 token hash, purpose, created/expiry/used/invalidated timestamps and requested IP. | One-time, revocable setup/reset tokens without storing bearer tokens. |
| `StaffUser` | Nullable password hash and `PENDING_SETUP` status. | New accounts cannot sign in until password setup succeeds. |
| `VehicleStaffAssignment` | New table with vehicle/staff FKs, assigning/revoking staff references, assignment/expiry/revocation timestamps and lookup indexes. | Scoped vehicle assignment for maintainers. |

The proposal already contains `StaffUser`, role/permission joins, `StaffSession`, and `AuditLog`; do not recreate those tables. Use foreign-key `RESTRICT` for retained staff/vehicle assignment history where appropriate; invalidate reset tokens and revoke sessions instead of deleting the staff member. Review the exact active field definitions in `prisma/schema.prisma` against the approved schema before preparing migration SQL.

The permission catalog also adds `staff.manage` as an administrator marker. The reviewed seed inserts the permission and grants it to the built-in `ADMIN` role; it does not require a new table or column.

### Constraints and concurrency

- Session and reset bearer values are random 256-bit tokens; persist only SHA-256 hashes with unique indexes.
- Login lockout increments are serialized by locking the staff row. Active sessions are revoked when credentials, roles, permissions, or account status change.
- Role/profile/status, token generation/revocation/use, password change, session revocation, and audit writes use database transactions where they change related state.
- The final active administrator is protected by checking `staff.manage`, `roles.manage`, and `staff.roles.assign_privileged` while active staff rows are locked under serializable transactions.
- Staff with permissions beyond the actor's scope cannot be edited, deactivated, demoted, or have sessions managed unless the actor has the explicit privileged-assignment permission.
- Vehicle assignment creation locks the staff row to serialize duplicate active assignments for that staff member.
- The UI only hides controls. Every protected route performs backend permission checks; owner-scoped session/assignment reads are checked in the service as well.

## Security and operations

- Passwords use Argon2id. Staff with `staff.manage` generate short-lived setup or reset tokens, share them securely and may revoke them. Only hashes are stored; use activates pending accounts or resets active accounts and revokes sessions. Token validation is rate limited. No password setup or reset emails are sent.
- The migration marks existing email tokens as `LEGACY_EMAIL`; they cannot be used with the new flow. Existing accounts keep their status and password hash.
- Staff creation, token issuance/revocation/use, sign-in and password change use a 30-second interactive transaction timeout to accommodate higher-latency database connections. The timeout remains bounded and failures still roll back the transaction.
- Sessions are HttpOnly cookies. Mutating browser requests require an allowlisted Origin and an HMAC-signed double-submit CSRF token. Production requires secure `__Host-` session cookies.
- Audit events avoid passwords, raw tokens, and unnecessary profile values. The audit API is read-only and requires `audit_logs.view`.
- Use TLS, exact CORS origins, a high-entropy environment-specific `CSRF_SECRET`, and only verified LankaHost proxy-hop settings. Keep the frontend and API on same-site HTTPS hosts to avoid third-party cookie restrictions.
- Express rate limits are process-local. Database lockout is account-based; multi-instance deployments should add a reviewed shared IP rate-limit store if the edge does not already enforce one.
- Bootstrap has no public HTTP endpoint. `npm run bootstrap:admin` only works when there are no staff users and requires temporary environment variables.
- The seed synchronizes built-in role permission templates; run it only during an intentional initial setup or reset.

## Explicitly not done

The administrator-token migration has not been applied by this change; no database was connected and the seed was not executed. Review migration status and backups before applying it to an approved target.
