import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig(overrides = {}) {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', 'mysql://u:p@localhost:3306/db');
  vi.stubEnv('FRONTEND_ORIGINS', 'http://localhost:5173');
  vi.stubEnv('CSRF_SECRET', 'x'.repeat(32));
  vi.stubEnv('NODE_ENV', 'test');
  delete process.env.SESSION_TTL_SECONDS;
  delete process.env.SESSION_IDLE_TTL_SECONDS;
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  const module = await import('../src/config/env.js');
  return module.config;
}

describe('staff session lifetime', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('documents a four-hour maximum and inactivity limit in .env.example', () => {
    const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    expect(example).toMatch(/^SESSION_TTL_SECONDS=14400$/m);
    expect(example).toMatch(/^SESSION_IDLE_TTL_SECONDS=14400$/m);
  });

  it('honours explicit environment overrides', async () => {
    const config = await loadConfig({ SESSION_TTL_SECONDS: '3600', SESSION_IDLE_TTL_SECONDS: '600' });
    expect(config.SESSION_TTL_SECONDS).toBe(3600);
    expect(config.SESSION_IDLE_TTL_SECONDS).toBe(600);
  });
});
