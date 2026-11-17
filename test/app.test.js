import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/aj_car_rentals';
process.env.FRONTEND_ORIGINS = 'http://localhost:5173';
process.env.CSRF_SECRET = 'test-secret-with-more-than-thirty-two-characters';

let app;

beforeAll(async () => {
  const { createApp } = await import('../src/app.js');
  app = createApp({ database: {} });
});

describe('application HTTP security', () => {
  it('serves liveness without touching the database', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('issues a CSRF token and blocks mutations without it', async () => {
    const csrfResponse = await request(app)
      .get('/api/auth/csrf')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(csrfResponse.body.data.csrfToken).toBeTruthy();

    await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'staff@example.lk', password: 'a-valid-but-unused-password' })
      .expect(403);
  });
});
