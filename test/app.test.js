import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import helmet from 'helmet';
import { createPublicVehicleRouter } from '../src/modules/vehicles/vehicle.routes.js';

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

  describe('public vehicle catalogue routes', () => {
    it('validates filters and returns the paginated public catalogue', async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const count = vi.fn().mockResolvedValue(0);
      const database = {
        vehicle: { findMany, count },
        $transaction: (operations) => Promise.all(operations),
      };
      const { createApp } = await import('../src/app.js');
      const publicApp = createApp({ database });
      const response = await request(publicApp)
        .get('/api/v1/public/vehicles?category=SUV&page=2&limit=5')
        .expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.data).toEqual({
        items: [],
        pagination: { page: 2, limit: 5, total: 0, pages: 0 },
      });
      expect(findMany.mock.calls[0][0].where.specification.is.category).toBe('SUV');
      await request(publicApp).get('/api/v1/public/vehicles?limit=101').expect(400);
      await request(publicApp).get('/api/v1/public/vehicles/not-a-uuid').expect(400);
    });

    it('allows cross-origin embedding only for successfully retrieved public images', async () => {
      const publicImage = vi.fn().mockResolvedValue({
        buffer: Buffer.from('image'),
        mimeType: 'image/png',
        sha256: 'hash',
      });
      const imageApp = express();
      imageApp.use(helmet());
      imageApp.use(createPublicVehicleRouter({ vehicleService: { publicImage } }));
      imageApp.get('/private', (_req, res) => res.send('private'));
      const response = await request(imageApp)
        .get('/vehicles/11111111-1111-4111-8111-111111111111/images/22222222-2222-4222-8222-222222222222')
        .expect(200);
      expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect((await request(imageApp).get('/private').expect(200)).headers['cross-origin-resource-policy'])
        .toBe('same-origin');
    });
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
