# Backend deployment troubleshooting

| Symptom | Checks |
|---|---|
| FTP authentication fails | Verify the backend account username and current password in the backend repository or `production` environment secrets; an environment secret overrides a repository secret with the same name. Check account status with the host. Do not print credentials. |
| TLS or certificate failure | Confirm explicit FTPS on port 21 and certificate validity. Do not disable verification or fall back to plain FTP. |
| Permission denied or files missing | Inspect the FTP account's accessible directory and verify `FTP_REMOTE_DIR`; its default is `./`. Do not broaden permissions. Check whether a previously tracked file was removed from the package. |
| `npm start` fails | Check the configured cPanel Node.js application, Node 22, startup file `src/server.js`, existing host `.env`, and sanitized application logs. |
| Prisma or Argon2 native error | Install dependencies and generate Prisma Client on the host; verify Node version, host OS, architecture, OpenSSL and sanitized errors. The workflow does not upload generated dependencies. |
| Readiness check fails | Manually check `/ready`, which queries the database. Verify the host restart, production environment, and DB access using sanitized logs. `/health` does not test the database. |
| Migration fails | Stop. Check migration status, reviewed SQL, database backup, and host connectivity. Use an operator-approved recovery plan; never reset or push the schema. |
| Application did not restart | Use the hosting panel's documented restart mechanism. The workflow does not create a restart marker or restart the application. |
| Persistent uploads are unavailable | Verify `VEHICLE_STORAGE_ROOT` points to persistent private storage. The workflow excludes `var/` and never uploads `.env`. |

The sync action may delete previously tracked files removed from the package;
it does not perform a health check. Diagnose using provider logs without
exposing customer data or secrets.
