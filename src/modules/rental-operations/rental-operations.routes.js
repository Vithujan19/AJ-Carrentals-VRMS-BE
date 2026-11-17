import { Router } from 'express';
import { z } from 'zod';
import { requireAnyPermission, requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../shared/errors.js';
import { requestAuditContext } from '../../shared/audit.js';
import {
  bookingOperationParamsSchema,
  chargeDecisionSchema,
  completeOperationSchema,
  createChargeSchema,
  createDamageSchema,
  createPaymentSchema,
  depositApplicationSchema,
  customerDocumentParamsSchema,
  customerDocumentsSchema,
  customerVerificationSchema,
  damageDecisionSchema,
  damageListSchema,
  damageParamsSchema,
  dashboardSchema,
  draftPhotoParamsSchema,
  draftSchema,
  finalizeSchema,
  operationParamsSchema,
  photoParamsSchema,
  policyConfigurationSchema,
  receiptParamsSchema,
  refundSchema,
  paymentCorrectionSchema,
} from './rental-operations.schemas.js';

function requireOperationPermission(action) {
  return function authorizeRentalOperation(req, _res, next) {
    const operation = req.params.operation;
    const permission = `rental.${operation}.${action}`;
    if (!req.auth?.staff?.permissions.includes(permission)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this rental operation.');
    }
    next();
  };
}

function sendFile(res, {
  buffer,
  mimeType,
  sha256,
  originalName,
  disposition,
}) {
  res.set('Content-Type', mimeType);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Security-Policy', "default-src 'none'; sandbox");
  if (sha256) {
    const etag = `"${sha256}"`;
    res.set('ETag', etag);
    if (res.req.get('if-none-match') === etag) {
      res.status(304).end();
      return;
    }
  }
  if (disposition) {
    const safeFallback = originalName
      ? originalName.replace(/[^\x20-\x7e]|["\\;]/g, '_')
      : 'download';
    const encoded = encodeURIComponent(originalName ?? 'download');
    res.set(
      'Content-Disposition',
      `${disposition}; filename="${safeFallback}"; filename*=UTF-8''${encoded}`,
    );
  }
  res.send(buffer);
}

export function createRentalOperationsRouter({
  service,
  authenticate,
  upload,
}) {
  const router = Router();
  router.use(authenticate);

  router.get(
    '/dashboard',
    requireAnyPermission(
      'rental.active.view',
      'rental.operations.view',
      'rental.operations.view.assigned',
    ),
    validate(dashboardSchema),
    async (req, res) => {
      res.json({
        data: await service.dashboard({
          query: req.validated.query,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.get(
    '/policy',
    requireAnyPermission(
      'settings.view',
      'rental.operations.view',
      'rental.operations.view.assigned',
      'rental.active.view',
    ),
    async (_req, res) => {
      res.json({ data: await service.policy() });
    },
  );

  router.put(
    '/policy',
    requirePermission('settings.manage'),
    validate(policyConfigurationSchema),
    async (req, res) => {
      res.json({
        data: await service.updatePolicy({
          input: req.validated.body,
          actor: req.auth.staff,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.get(
    '/damages',
    requirePermission('rental.damage.view'),
    validate(damageListSchema),
    async (req, res) => {
      res.json({
        data: await service.listDamages({
          query: req.validated.query,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.get(
    '/customers/:customerId/documents',
    requirePermission('customers.documents.view'),
    validate(customerDocumentsSchema),
    async (req, res) => {
      res.json({
        data: await service.listCustomerDocuments({
          customerId: req.validated.params.customerId,
        }),
      });
    },
  );

  router.get(
    '/customers/:customerId/documents/:documentId/download',
    requirePermission('customers.documents.view'),
    validate(customerDocumentParamsSchema),
    async (req, res) => {
      const document = await service.downloadCustomerDocument(req.validated.params);
      sendFile(res, { ...document, disposition: 'attachment' });
    },
  );

  router.post(
    '/charges/:chargeId/decision',
    requirePermission('rental.charges.approve'),
    validate(chargeDecisionSchema),
    async (req, res) => {
      res.json({
        data: await service.decideCharge({
          chargeId: req.validated.params.chargeId,
          input: req.validated.body,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.post(
    '/damages/:damageId/decision',
    requirePermission('rental.damage.approve'),
    validate(damageDecisionSchema),
    async (req, res) => {
      res.json({
        data: await service.decideDamage({
          damageId: req.validated.params.damageId,
          input: req.validated.body,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.post(
    '/damages/:damageId/images',
    requirePermission('rental.inspection.create'),
    upload.damageImages,
    validate(damageParamsSchema),
    async (req, res) => {
      res.status(201).json({
        data: await service.uploadDamageImage({
          damageId: req.validated.params.damageId,
          files: req.files,
          caption: req.body.caption,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.get(
    '/damages/:damageId/images/:imageId',
    requirePermission('rental.damage.view'),
    validate(z.object({
      params: z.object({ damageId: z.string().uuid(), imageId: z.string().uuid() }),
    })),
    async (req, res) => {
      const image = await service.downloadDamageImage({
        ...req.validated.params,
        actor: req.auth.staff,
        permissions: req.auth.staff.permissions,
      });
      sendFile(res, { ...image, disposition: 'inline' });
    },
  );

  router.get(
    '/bookings/:bookingId',
    requireAnyPermission(
      'rental.operations.view',
      'rental.operations.view.assigned',
      'rental.active.view',
    ),
    validate(bookingOperationParamsSchema),
    async (req, res) => {
      res.json({
        data: await service.getDetail({
          bookingId: req.validated.params.bookingId,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.get(
    '/bookings/:bookingId/financial-summary',
    requireAnyPermission('rental.charges.view', 'rental.payments.view'),
    validate(bookingOperationParamsSchema),
    async (req, res) => {
      res.json({
        data: await service.financialSummary({
          bookingId: req.validated.params.bookingId,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.post(
    '/bookings/:bookingId/customer-verification',
    requirePermission('customers.verify'),
    validate(customerVerificationSchema),
    async (req, res) => {
      res.status(201).json({
        data: await service.verifyCustomer({
          bookingId: req.validated.params.bookingId,
          input: req.validated.body,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.get(
    '/bookings/:bookingId/:operation/draft',
    requireOperationPermission('view'),
    validate(operationParamsSchema),
    async (req, res) => {
      res.json({
        data: await service.operationDraft({
          ...req.validated.params,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.post(
    '/bookings/:bookingId/:operation/draft',
    requireOperationPermission('create'),
    validate(operationParamsSchema),
    async (req, res) => {
      res.status(201).json({
        data: await service.startOperationDraft({
          ...req.validated.params,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.patch(
    '/bookings/:bookingId/:operation/draft',
    requireOperationPermission('create'),
    validate(draftSchema),
    async (req, res) => {
      res.json({
        data: await service.updateOperationDraft({
          ...req.validated.params,
          version: req.validated.body.version,
          payload: req.validated.body.payload,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.post(
    '/bookings/:bookingId/:operation/draft/photos',
    requirePermission('rental.inspection.create'),
    upload.photos,
    validate(draftPhotoParamsSchema),
    async (req, res) => {
      res.status(201).json({
        data: await service.uploadOperationPhotos({
          ...req.validated.params,
          files: req.files,
          caption: req.body.caption,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.get(
    '/bookings/:bookingId/photos/:photoId',
    requirePermission('rental.inspection.view'),
    validate(photoParamsSchema),
    async (req, res) => {
      const photo = await service.downloadOperationPhoto({
        ...req.validated.params,
        actor: req.auth.staff,
        permissions: req.auth.staff.permissions,
      });
      sendFile(res, { ...photo, disposition: 'inline' });
    },
  );

  router.post(
    '/bookings/:bookingId/:operation/complete',
    requireOperationPermission('complete'),
    validate(completeOperationSchema),
    async (req, res) => {
      const serviceMethod = req.validated.params.operation === 'handover'
        ? service.completeHandover
        : service.completeReturn;
      res.json({
        data: await serviceMethod({
          bookingId: req.validated.params.bookingId,
          version: req.validated.body.version,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.post(
    '/bookings/:bookingId/damages',
    requirePermission('rental.damage.create'),
    validate(createDamageSchema),
    async (req, res) => {
      res.status(201).json({
        data: await service.createDamage({
          bookingId: req.validated.params.bookingId,
          input: req.validated.body,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.post(
    '/bookings/:bookingId/charges',
    requirePermission('rental.charges.create'),
    validate(createChargeSchema),
    async (req, res) => {
      res.status(201).json({
        data: await service.createCharge({
          bookingId: req.validated.params.bookingId,
          input: req.validated.body,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.post(
    '/bookings/:bookingId/deposit-applications',
    requirePermission('rental.deposits.apply'),
    validate(depositApplicationSchema),
    async (req, res) => {
      res.status(201).json({
        data: await service.applyDeposit({
          bookingId: req.validated.params.bookingId,
          input: req.validated.body,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.post(
    '/bookings/:bookingId/payments',
    requirePermission('rental.payments.create'),
    validate(createPaymentSchema),
    async (req, res) => {
      res.status(201).json({
        data: await service.createPayment({
          bookingId: req.validated.params.bookingId,
          input: req.validated.body,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.post(
    '/bookings/:bookingId/payments/:paymentId/refunds',
    requirePermission('rental.payments.refund'),
    validate(refundSchema),
    async (req, res) => {
      res.status(201).json({
        data: await service.refundPayment({
          ...req.validated.params,
          input: req.validated.body,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.post(
    '/bookings/:bookingId/payments/:paymentId/corrections',
    requirePermission('rental.payments.correct'),
    validate(paymentCorrectionSchema),
    async (req, res) => {
      res.json({
        data: await service.correctPayment({
          ...req.validated.params,
          reason: req.validated.body.reason,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.post(
    '/bookings/:bookingId/payments/:paymentId/receipts',
    requirePermission('rental.payments.create'),
    upload.receipt,
    validate(receiptParamsSchema),
    async (req, res) => {
      res.status(201).json({
        data: await service.uploadPaymentReceipt({
          ...req.validated.params,
          file: req.file,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.get(
    '/bookings/:bookingId/payments/:paymentId/receipts/:receiptId/download',
    requirePermission('rental.payments.view'),
    validate(z.object({
      params: z.object({
        bookingId: z.string().uuid(),
        paymentId: z.string().uuid(),
        receiptId: z.string().uuid(),
      }),
    })),
    async (req, res) => {
      const receipt = await service.downloadPaymentReceipt({
        ...req.validated.params,
        actor: req.auth.staff,
        permissions: req.auth.staff.permissions,
      });
      sendFile(res, { ...receipt, disposition: 'attachment' });
    },
  );

  router.post(
    '/bookings/:bookingId/finalize',
    requirePermission('rental.finalize'),
    validate(finalizeSchema),
    async (req, res) => {
      res.json({
        data: await service.finalizeRental({
          bookingId: req.validated.params.bookingId,
          notes: req.validated.body.notes,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  return router;
}
