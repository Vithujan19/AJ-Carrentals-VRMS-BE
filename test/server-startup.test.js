import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('server startup', () => {
  it('can be required by a CommonJS host and reports database connection failures', () => {
    const result = spawnSync(
      process.execPath,
      ['-e', "require('./src/server.js'); console.log('ENTRY_REQUIRE_OK');"],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 15_000,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATABASE_URL: 'mysql://ci:ci@127.0.0.1:1/ci?connect_timeout=1',
          FRONTEND_ORIGINS: 'http://localhost:5173',
          CSRF_SECRET: 'test-secret-with-more-than-thirty-two-characters',
        },
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('ENTRY_REQUIRE_OK');
    expect(result.stdout).toContain('server_start_failed');
    expect(result.stderr).not.toContain('ERR_REQUIRE_ASYNC_MODULE');
  }, 20_000);
});
