import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './db/prisma.js';
import { createAuthenticate } from './middleware/authenticate.js';
import { createCsrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createAuditRouter } from './modules/audit/audit.routes.js';
import { createAuditService } from './modules/audit/audit.service.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createRolesRouter } from './modules/roles/roles.routes.js';
import { createRolesService } from './modules/roles/roles.service.js';
import { createStaffRouter } from './modules/staff/staff.routes.js';
import { createStaffService } from './modules/staff/staff.service.js';
import { createBookingRouter, createPublicBookingRouter } from './modules/bookings/booking.routes.js';
import { createBookingService } from './modules/bookings/booking.service.js';
import { createBookingNotificationDelivery } from './modules/bookings/booking-notification-delivery.js';
import { createWhatsAppRouter, createWhatsAppWebhookRouter } from './modules/whatsapp/whatsapp.routes.js';
import { createWhatsAppService } from './modules/whatsapp/whatsapp.service.js';
import { createPricingRouter } from './modules/pricing/pricing.routes.js';
import { createPricingService } from './modules/pricing/pricing.service.js';
import { createPublicVehicleRouter, createVehicleRouter } from './modules/vehicles/vehicle.routes.js';
import { createVehicleMediaService } from './modules/vehicles/vehicle-media.service.js';
import { createVehicleService } from './modules/vehicles/vehicle.service.js';
import { createVehicleUploadMiddleware } from './modules/vehicles/upload-middleware.js';
import { createRentalOperationsRouter } from './modules/rental-operations/rental-operations.routes.js';
import { createRentalOperationsService } from './modules/rental-operations/rental-operations.service.js';
import { createRentalOperationsUploadMiddleware } from './modules/rental-operations/rental-operations.upload.js';
import { createLocalFileStorage } from './shared/storage/local-file-storage.js';

export function createApp({
  applicationConfig = config,
  applicationLogger = logger,
  database = prisma,
} = {}) {
  const app = express();
  const authService = createAuthService({
    prisma: database,
    config: applicationConfig,
  });
  const authenticate = createAuthenticate(authService, applicationConfig);
  const vehicleStorage = createLocalFileStorage(applicationConfig.VEHICLE_STORAGE_ROOT);
  const vehicleUpload = createVehicleUploadMiddleware(applicationConfig);
  const rentalOperationsUpload = createRentalOperationsUploadMiddleware(applicationConfig);
  const rentalOperationsService = createRentalOperationsService({
    prisma: database,
    storage: vehicleStorage,
  });
  const vehicleService = createVehicleService({
    prisma: database,
    config: applicationConfig,
    storage: vehicleStorage,
  });
  const vehicleMediaService = createVehicleMediaService({
    prisma: database,
    storage: vehicleStorage,
  });
  const pricingService = createPricingService({ prisma: database });
  const bookingNotificationDelivery = createBookingNotificationDelivery(applicationConfig);
  const whatsappService = createWhatsAppService({
    prisma: database,
    config: applicationConfig,
    logger: applicationLogger,
  });
  const bookingService = createBookingService({
    prisma: database,
    logger: applicationLogger,
    notificationDelivery: bookingNotificationDelivery,
    whatsappService,
    whatsappConfig: applicationConfig,
  });

  app.set('trust proxy', applicationConfig.TRUST_PROXY_HOPS);
  app.use(
    pinoHttp({
      logger: applicationLogger,
      genReqId(_req, res) {
        const requestId = randomUUID();
        res.setHeader('x-request-id', requestId);
        return requestId;
      },
    }),
  );
  app.use(
    helmet({
      hsts: applicationConfig.NODE_ENV === 'production' ? undefined : false,
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || applicationConfig.frontendOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({
    limit: '64kb',
    verify(req, _res, buffer) {
      req.rawBody = buffer;
    },
  }));
  app.use(cookieParser());
  app.use(createCsrfProtection(applicationConfig));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/ready', async (_req, res) => {
    await database.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  });
  app.use('/api/auth', createAuthRouter({ authService, authenticate, config: applicationConfig }));
  app.use(
    '/api/staff',
    createStaffRouter({
      staffService: createStaffService({ prisma: database, config: applicationConfig }),
      authenticate,
    }),
  );
  app.use(
    '/api/roles',
    createRolesRouter({ rolesService: createRolesService({ prisma: database }), authenticate }),
  );
  app.use(
    '/api/audit-logs',
    createAuditRouter({ auditService: createAuditService({ prisma: database }), authenticate }),
  );
  app.use(
    '/api/v1/public',
    createPublicBookingRouter({ bookingService, whatsappService, prisma: database }),
  );
  app.use(
    '/api/v1/public',
    createPublicVehicleRouter({ vehicleService }),
  );
  app.use('/api/v1/webhooks/whatsapp', createWhatsAppWebhookRouter({ whatsappService }));
  app.use('/api/v1/whatsapp', createWhatsAppRouter({ whatsappService, authenticate }));
  app.use(
    '/api/v1/bookings',
    createBookingRouter({ bookingService, authenticate }),
  );
  app.use(
    '/api/v1/vehicles',
    createVehicleRouter({
      vehicleService,
      mediaService: vehicleMediaService,
      authenticate,
      upload: vehicleUpload,
    }),
  );
  app.use(
    '/api/v1/rental-operations',
    createRentalOperationsRouter({
      service: rentalOperationsService,
      authenticate,
      upload: rentalOperationsUpload,
    }),
  );
  app.use(
    '/api/v1',
    createPricingRouter({ pricingService, authenticate }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler(applicationLogger));
  return app;
}
