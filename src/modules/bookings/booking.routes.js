import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAnyPermission, requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { requestAuditContext } from '../../shared/audit.js';
import {
  availabilitySchema,
  bookingCalendarSchema,
  bookingIdSchema,
  bookingListSchema,
  bookingReasonSchema,
  customerSearchSchema,
  publicCreateBookingSchema,
  publicLookupSchema,
  staffCreateBookingSchema,
  updateBookingSchema,
} from './booking.schemas.js';

function publicRateLimit(message) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(_req, res) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message,
        },
      });
    },
  });
}

export function createPublicBookingRouter({ bookingService }) {
  const router = Router();
  const requestLimiter = publicRateLimit('Too many booking requests. Try again later.');
  const lookupLimiter = publicRateLimit('Too many booking lookups. Try again later.');

  router.get('/vehicles/available', validate(availabilitySchema), async (req, res) => {
    res.json({
      data: await bookingService.availableVehicles({
        query: req.validated.query,
        publicOnly: true,
      }),
    });
  });

  router.get('/availability', validate(availabilitySchema), async (req, res) => {
    res.json({
      data: await bookingService.availableVehicles({
        query: req.validated.query,
        publicOnly: true,
      }),
    });
  });

  router.post(
    '/booking-requests',
    requestLimiter,
    validate(publicCreateBookingSchema),
    async (req, res) => {
      const booking = await bookingService.createPublicRequest({
        input: req.validated.body,
        auditContext: requestAuditContext(req),
      });
      res.status(201).json({
        data: {
          reference: booking.reference,
          status: booking.status,
          pickupAt: booking.pickupAt,
          returnAt: booking.returnAt,
          estimatedTotal: booking.estimatedTotal,
          currency: booking.currency,
          lookupToken: booking.lookupToken,
        },
      });
    },
  );

  router.post(
    '/booking-lookup',
    lookupLimiter,
    validate(publicLookupSchema),
    async (req, res) => {
      const booking = await bookingService.publicLookup(req.validated.body);
      res.json({ data: booking });
    },
  );

  return router;
}

export function createBookingRouter({ bookingService, authenticate }) {
  const router = Router();
  router.use(authenticate);

  router.get(
    '/availability',
    requirePermission('bookings.availability.view'),
    validate(availabilitySchema),
    async (req, res) => {
      res.json({
        data: await bookingService.availableVehicles({
          query: req.validated.query,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.get(
    '/customers',
    requirePermission('customers.view'),
    validate(customerSearchSchema),
    async (req, res) => {
      res.json({
        data: await bookingService.customerSearch(req.validated.query),
      });
    },
  );

  router.get(
    '/calendar',
    requirePermission('bookings.calendar.view'),
    validate(bookingCalendarSchema),
    async (req, res) => {
      res.json({
        data: await bookingService.calendar({
          query: req.validated.query,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.get(
    '/',
    requireAnyPermission('bookings.view', 'bookings.view.assigned'),
    validate(bookingListSchema),
    async (req, res) => {
      res.json({
        data: await bookingService.list({
          query: req.validated.query,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.post(
    '/',
    requirePermission('bookings.create'),
    validate(staffCreateBookingSchema),
    async (req, res) => {
      const booking = await bookingService.createStaffBooking({
        input: req.validated.body,
        actor: req.auth.staff,
        permissions: req.auth.staff.permissions,
        auditContext: requestAuditContext(req),
      });
      res.status(201).json({ data: booking });
    },
  );

  router.get(
    '/:id',
    requireAnyPermission('bookings.view', 'bookings.view.assigned'),
    validate(bookingIdSchema),
    async (req, res) => {
      res.json({
        data: await bookingService.getById({
          id: req.validated.params.id,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.get(
    '/:id/history',
    requireAnyPermission('bookings.view', 'bookings.view.assigned'),
    validate(bookingIdSchema),
    async (req, res) => {
      res.json({
        data: await bookingService.history({
          id: req.validated.params.id,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.patch(
    '/:id',
    requirePermission('bookings.update'),
    validate(updateBookingSchema),
    async (req, res) => {
      res.json({
        data: await bookingService.update({
          id: req.validated.params.id,
          input: req.validated.body,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.post(
    '/:id/review',
    requirePermission('bookings.update'),
    validate(bookingReasonSchema),
    async (req, res) => {
      res.json({
        data: await bookingService.transition({
          id: req.validated.params.id,
          toStatus: 'UNDER_REVIEW',
          reason: req.validated.body.reason,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.post(
    '/:id/confirm',
    requirePermission('bookings.confirm'),
    validate(bookingIdSchema),
    async (req, res) => {
      res.json({
        data: await bookingService.confirm({
          id: req.validated.params.id,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  for (const [action, permission, toStatus] of [
    ['reject', 'bookings.reject', 'REJECTED'],
    ['cancel', 'bookings.cancel', 'CANCELLED'],
    ['expire', 'bookings.expire', 'EXPIRED'],
    ['no-show', 'bookings.no_show', 'NO_SHOW'],
  ]) {
    router.post(
      `/:id/${action}`,
      requirePermission(permission),
      validate(bookingReasonSchema),
      async (req, res) => {
        res.json({
          data: await bookingService.transition({
            id: req.validated.params.id,
            toStatus,
            reason: req.validated.body.reason,
            actor: req.auth.staff,
            permissions: req.auth.staff.permissions,
            auditContext: requestAuditContext(req),
          }),
        });
      },
    );
  }

  return router;
}
