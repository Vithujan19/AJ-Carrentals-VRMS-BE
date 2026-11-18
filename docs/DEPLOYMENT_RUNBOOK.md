# Backend deployment runbook

## Before the first deployment

1. Protect `master` with reviewed pull requests and required CI. Configure the
   `production` environment to permit protected `master` only and require
   reviewers.
2. Set the FTP secrets and variables in
   [GitHub Actions setup](./GITHUB_ACTIONS_SETUP.md).
3. Verify the remote directory is the backend application directory, Node.js
   22 or later is available, and the hosting panel supports installing
   dependencies, generating Prisma Client, running reviewed migrations, and
   restarting the Node application.
4. Confirm the existing production `.env`, private upload/storage directory,
   startup command (`npm start`), CORS origin, cookie settings, proxy
   configuration, and HTTPS behavior on the host. Never upload a replacement
   `.env`.
5. Review the migrations and confirm production database history, connectivity,
   backups, and a tested recovery plan. Do not turn on migrations from this
   workflow.
6. Enable the deployment variable only after the above checks and explicit
   approval. The first deployment requires production environment approval.

## Upload, migrate, restart, and verify

- CI validates and uploads a source-only package over verified explicit FTPS,
  preserving `.env`, `var/`, uploads, and unknown remote files. Remote
  deletion is never used. Upload writes directly to the live application
  directory and is not atomic; arrange a maintenance window and a tested
  backup before uploading.
- Using a hosting-supported command facility in the application directory,
  install the locked dependencies with `npm ci --include=dev`, then run
  `npm run prisma:generate`. The Prisma CLI is a dev dependency and there is
  no postinstall generation script. If the panel only installs production
  dependencies and cannot run these commands, arrange a supported alternative
  with the host before enabling upload.
- Database migrations are not run by GitHub Actions. After a verified backup
  and migration review/approval, run `npx --no-install prisma migrate deploy`
  in the host application directory using the existing protected
  `DATABASE_URL`. This applies all pending migrations. Never run
  `migrate reset`, `migrate dev`, or `db push`. Stop on any migration
  failure; do not restart the new release or blindly retry.
- Restart using the hosting panel's documented mechanism. Then manually check
  `https://bookapi.ajcarrentals.lk/health` and the database-backed
  `https://bookapi.ajcarrentals.lk/ready`. Neither endpoint proves that the
  new version is running; inspect the host's startup logs as well. The
  workflow does not restart the app or perform health checks.
- Roll back application files only from a known backup and after confirming
  compatibility with the current database schema. Database migrations are
  not automatically reversed; preserve persistent uploads during recovery.

No production deployment or migration was run by this change. The hosting
runtime, Passenger configuration, and database access remain unverified.
