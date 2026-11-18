# Backend deployment troubleshooting

| Symptom | Checks |
|---|---|
| FTP authentication fails | Verify backend-only secret names, account status, and that the rotated password was set in the backend repository/environment. Do not print credentials. |
| TLS or certificate failure | Confirm explicit FTPS on port 21 and certificate validity. Do not disable verification or fall back to plain FTP. |
| Permission denied or files missing | Inspect the FTP account's accessible directory and verify `BE_FTP_REMOTE_DIR`; its default is `./`. Do not broaden permissions or use remote deletion. |
| `npm start` fails | Check the configured cPanel Node.js application, Node 22, startup file `src/server.js`, existing host `.env`, and sanitized application logs. |
| Prisma or Argon2 native error | Install dependencies and generate Prisma Client on the host; verify Node version, host OS, architecture, OpenSSL and sanitized errors. The workflow does not upload generated dependencies. |
| Readiness check fails | Manually check `/ready`, which queries the database. Verify the host restart, production environment, and DB access using sanitized logs. `/health` does not test the database. |
| Migration fails | Stop. Check migration status, reviewed SQL, database backup, and host connectivity. Use an operator-approved recovery plan; never reset or push the schema. |
| Application did not restart | Use the hosting panel's documented restart mechanism. The workflow does not create a restart marker or restart the application. |
| Persistent uploads are unavailable | Verify `VEHICLE_STORAGE_ROOT` points to persistent private storage. The workflow excludes `var/` and never uploads `.env`. |

The workflow never deletes remote files or performs a health check. Diagnose
using provider logs without exposing customer data or secrets.
