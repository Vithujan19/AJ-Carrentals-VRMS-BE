# LankaHost backend FTPS deployment

The backend workflow uses explicit FTPS to `ftp.ajcarrentals.lk:21`, enforces
TLS for control and data connections, and verifies the certificate. It uses
the backend-only account `aj_carrentals@bookapi.ajcarrentals.lk`; configure
its rotated password as the backend repository's `FTP_PASSWORD` secret.

`FTP_REMOTE_DIR` defaults to `./`, relative to the backend FTP account's
accessible root. Verify that root is the Node application directory through
LankaHost or an authorized FTP directory listing before enabling deployment.
Do not assume it maps to the hosting account root.

The package contains application source, scripts, package manifests, the
Prisma schema and migrations. It contains neither `node_modules` nor generated
Prisma Client. Install dependencies and generate the client on the hosting
server, so Prisma and Argon2 match its architecture and OpenSSL. The workflow
does not upload `.env`, `var/`, user uploads or logs.

The workflow uses the same FTP deployment action as the frontend, configured
for explicit FTPS and strict certificate verification. It maintains its own
`.aj-car-rentals-backend-ftp-sync-state.json` on the server and can delete
previously tracked application files removed from the package. Keep this
state file separate from the frontend's and verify the target directory
before deployment. The action does not use a clean-slate deletion.

FTP cannot execute remote commands. The workflow does not restart the app or
run migrations or health checks. Use the hosting panel's supported process
manager and restart procedure after installing dependencies and applying any
reviewed migrations. Do not assume a Passenger restart marker is supported.

No live host inspection was possible in the repository. Do not enable the
deployment gates until the host configuration and remote directory have been
independently verified.
