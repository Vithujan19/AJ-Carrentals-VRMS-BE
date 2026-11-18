# GitHub Actions setup

The workflow at `.github/workflows/deploy.yml` validates pull requests and
pushes to `master` on Node.js 22 and 24. Only `master` can upload a package.

## Backend repository settings

Add these repository or `production` environment secrets:

| Secret | Value |
|---|---|
| `FTP_SERVER` | `ftp.ajcarrentals.lk` |
| `FTP_USERNAME` | `aj_carrentals@bookapi.ajcarrentals.lk` |
| `FTP_PASSWORD` | The rotated backend FTP password |

The workflow uses port `21` for explicit FTPS; no port secret is required.

Add these repository variables:

| Variable | Value |
|---|---|
| `FTP_REMOTE_DIR` | `./` unless the FTP account's application directory is verified elsewhere |
| `ENABLE_PRODUCTION_DEPLOYMENT` | Leave unset or `false` until production setup and first-deploy approval are complete |

Protect `master` with reviewed pull requests and required CI. Create a
`production` GitHub Environment, restrict deployments to `master`, and
configure required reviewers. Confirm the repository's plan enforces these
protections. The workflow uploads a source-only package over explicit FTPS
with TLS certificate verification. The FTP action records deployed files in
`.aj-car-rentals-backend-ftp-sync-state.json` and may delete previously tracked
files removed from a later package. It does not upload `.env`, dependencies,
uploads, or persistent `var/` data; these paths are excluded from syncing.

## Triggers and manual deployment

- Pull requests to `master`: `npm ci`, Prisma validation and generation, lint,
  tests, and source package preparation. No deployment occurs.
- Pushes to `master`: upload requires `ENABLE_PRODUCTION_DEPLOYMENT=true` and
  production environment approval.
- Manual run: select the approved `master` ref and check
  `confirm_production_deployment`; the same validation, gates and approval
  apply.

An upload is not a completed release. Install dependencies, generate Prisma
Client, apply reviewed migrations when needed, restart, and verify health on
the host as described in the [runbook](./DEPLOYMENT_RUNBOOK.md). The workflow
does none of these hosting-side actions. Do not place a database URL or FTP
password in the workflow or logs.
