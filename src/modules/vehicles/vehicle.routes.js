import { Router } from 'express';
import { z } from 'zod';
import { requireAnyPermission, requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { requestAuditContext } from '../../shared/audit.js';
import {
  archiveVehicleSchema,
  createMileageReadingSchema,
  createVehicleDocumentSchema,
  createVehicleSchema,
  imageIdSchema,
  mileageCorrectionSchema,
  mileageListSchema,
  publicVehicleListSchema,
  reorderVehicleImagesSchema,
  updateVehicleDocumentSchema,
  updateVehicleImageSchema,
  updateVehicleSchema,
  updateVehicleStatusSchema,
  vehicleDocumentParamsSchema,
  vehicleIdSchema,
  vehicleListSchema,
} from './vehicle.schemas.js';

function sendFile(res, {
  buffer,
  mimeType,
  sha256,
  originalName,
  disposition,
  cacheControl,
}) {
  res.set('Content-Type', mimeType);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', cacheControl);
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

export function createVehicleRouter({
  vehicleService,
  mediaService,
  authenticate,
  upload,
}) {
  const router = Router();
  router.use(authenticate);

  router.get(
    '/',
    requireAnyPermission('vehicles.view', 'vehicles.view.assigned'),
    validate(vehicleListSchema),
    async (req, res) => {
      res.json({
        data: await vehicleService.list({
          query: req.validated.query,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.post(
    '/',
    requirePermission('vehicles.create'),
    validate(createVehicleSchema),
    async (req, res) => {
      const vehicle = await vehicleService.create({
        input: req.validated.body,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.status(201).json({ data: vehicle });
    },
  );

  router.put(
    '/:id/images/order',
    requirePermission('vehicles.images.manage'),
    validate(reorderVehicleImagesSchema),
    async (req, res) => {
      const result = await mediaService.reorderImages({
        vehicleId: req.validated.params.id,
        imageIds: req.validated.body.imageIds,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: result });
    },
  );

  router.get(
    '/:id',
    requireAnyPermission('vehicles.view', 'vehicles.view.assigned'),
    validate(vehicleIdSchema),
    async (req, res) => {
      res.json({
        data: await vehicleService.getById({
          id: req.validated.params.id,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.patch(
    '/:id',
    requirePermission('vehicles.update'),
    validate(updateVehicleSchema),
    async (req, res) => {
      const vehicle = await vehicleService.update({
        id: req.validated.params.id,
        input: req.validated.body,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: vehicle });
    },
  );

  router.patch(
    '/:id/status',
    requirePermission('vehicles.status.update'),
    validate(updateVehicleStatusSchema),
    async (req, res) => {
      const vehicle = await vehicleService.updateStatus({
        id: req.validated.params.id,
        ...req.validated.body,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: vehicle });
    },
  );

  router.post(
    '/:id/archive',
    requirePermission('vehicles.archive'),
    validate(archiveVehicleSchema),
    async (req, res) => {
      const vehicle = await vehicleService.archive({
        id: req.validated.params.id,
        reason: req.validated.body.reason,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: vehicle });
    },
  );

  router.get(
    '/:id/images',
    requireAnyPermission('vehicles.view', 'vehicles.view.assigned'),
    validate(vehicleIdSchema),
    async (req, res) => {
      res.json({
        data: await mediaService.listImages({
          vehicleId: req.validated.params.id,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.post(
    '/:id/images',
    requirePermission('vehicles.images.manage'),
    upload.images,
    validate(vehicleIdSchema),
    async (req, res) => {
      const images = await mediaService.uploadImages({
        vehicleId: req.validated.params.id,
        files: req.files,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.status(201).json({ data: images });
    },
  );

  router.patch(
    '/:id/images/:imageId',
    requirePermission('vehicles.images.manage'),
    validate(updateVehicleImageSchema),
    async (req, res) => {
      const image = await mediaService.updateImage({
        vehicleId: req.validated.params.id,
        imageId: req.validated.params.imageId,
        input: req.validated.body,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: image });
    },
  );

  router.delete(
    '/:id/images/:imageId',
    requirePermission('vehicles.images.manage'),
    validate(imageIdSchema),
    async (req, res) => {
      const result = await mediaService.archiveImage({
        vehicleId: req.validated.params.id,
        imageId: req.validated.params.imageId,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: result });
    },
  );

  router.get(
    '/:id/images/:imageId/content',
    requireAnyPermission('vehicles.view', 'vehicles.view.assigned'),
    validate(imageIdSchema),
    async (req, res) => {
      const image = await mediaService.downloadImage({
        vehicleId: req.validated.params.id,
        imageId: req.validated.params.imageId,
        actor: req.auth.staff,
        permissions: req.auth.staff.permissions,
      });
      sendFile(res, {
        ...image,
        disposition: 'inline',
        cacheControl: 'private, no-store',
      });
    },
  );

  router.get(
    '/:id/documents',
    requirePermission('vehicles.documents.view'),
    validate(vehicleIdSchema),
    async (req, res) => {
      res.json({ data: await mediaService.listDocuments(req.validated.params.id) });
    },
  );

  router.post(
    '/:id/documents',
    requirePermission('vehicles.documents.manage'),
    upload.document,
    validate(createVehicleDocumentSchema),
    async (req, res) => {
      const document = await mediaService.uploadDocument({
        vehicleId: req.validated.params.id,
        file: req.file,
        input: req.validated.body,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.status(201).json({ data: document });
    },
  );

  router.patch(
    '/:id/documents/:documentId',
    requirePermission('vehicles.documents.manage'),
    validate(updateVehicleDocumentSchema),
    async (req, res) => {
      const document = await mediaService.updateDocument({
        vehicleId: req.validated.params.id,
        documentId: req.validated.params.documentId,
        input: req.validated.body,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: document });
    },
  );

  router.delete(
    '/:id/documents/:documentId',
    requirePermission('vehicles.documents.manage'),
    validate(vehicleDocumentParamsSchema),
    async (req, res) => {
      const result = await mediaService.archiveDocument({
        vehicleId: req.validated.params.id,
        documentId: req.validated.params.documentId,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: result });
    },
  );

  router.get(
    '/:id/documents/:documentId/download',
    requirePermission('vehicles.documents.view'),
    validate(vehicleDocumentParamsSchema),
    async (req, res) => {
      const document = await mediaService.downloadDocument({
        vehicleId: req.validated.params.id,
        documentId: req.validated.params.documentId,
      });
      sendFile(res, {
        ...document,
        disposition: 'attachment',
        cacheControl: 'private, no-store',
      });
    },
  );

  router.get(
    '/:id/mileage',
    requireAnyPermission('vehicles.mileage.view', 'vehicles.view', 'vehicles.view.assigned'),
    validate(mileageListSchema),
    async (req, res) => {
      const { page, limit } = req.validated.query;
      res.json({
        data: await vehicleService.mileageHistory({
          id: req.validated.params.id,
          page,
          limit,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.post(
    '/:id/mileage',
    requirePermission('vehicles.mileage.update'),
    validate(createMileageReadingSchema),
    async (req, res) => {
      const result = await vehicleService.recordMileage({
        id: req.validated.params.id,
        ...req.validated.body,
        correction: false,
        actor: req.auth.staff,
        permissions: req.auth.staff.permissions,
        auditContext: requestAuditContext(req),
      });
      res.status(201).json({ data: result });
    },
  );

  router.post(
    '/:id/mileage/corrections',
    requirePermission('vehicles.mileage.correct'),
    validate(mileageCorrectionSchema),
    async (req, res) => {
      const result = await vehicleService.recordMileage({
        id: req.validated.params.id,
        ...req.validated.body,
        correction: true,
        actor: req.auth.staff,
        permissions: req.auth.staff.permissions,
        auditContext: requestAuditContext(req),
      });
      res.status(201).json({ data: result });
    },
  );

  router.get(
    '/:id/maintenance-history',
    requireAnyPermission('vehicles.view', 'vehicles.view.assigned'),
    requirePermission('vehicles.maintenance.view'),
    validate(mileageListSchema),
    async (req, res) => {
      const { page, limit } = req.validated.query;
      res.json({
        data: await vehicleService.maintenanceHistory({
          id: req.validated.params.id,
          page,
          limit,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.get(
    '/:id/booking-history',
    requireAnyPermission('vehicles.view', 'vehicles.view.assigned'),
    requirePermission('vehicles.booking_history.view'),
    validate(mileageListSchema),
    async (req, res) => {
      const { page, limit } = req.validated.query;
      res.json({
        data: await vehicleService.bookingHistory({
          id: req.validated.params.id,
          page,
          limit,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  router.get(
    '/:id/audit-history',
    requirePermission('vehicles.audit.view'),
    validate(mileageListSchema),
    async (req, res) => {
      const { page, limit } = req.validated.query;
      res.json({
        data: await vehicleService.auditHistory({
          id: req.validated.params.id,
          page,
          limit,
          actor: req.auth.staff,
          permissions: req.auth.staff.permissions,
        }),
      });
    },
  );

  return router;
}

export function createPublicVehicleRouter({ vehicleService }) {
  const router = Router();
  router.get('/vehicles', validate(publicVehicleListSchema), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await vehicleService.publicList({ query: req.validated.query }) });
  });
  router.get('/vehicles/:id', validate(vehicleIdSchema), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await vehicleService.publicDetail({ id: req.validated.params.id }) });
  });
  router.get(
    '/vehicles/:vehicleId/images/:imageId',
    validate(z.object({
      params: z.object({ vehicleId: z.string().uuid(), imageId: z.string().uuid() }),
    })),
    async (req, res) => {
      const { vehicleId, imageId } = req.params;
      const image = await vehicleService.publicImage({ vehicleId, imageId });
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      sendFile(res, {
        ...image,
        disposition: 'inline',
        cacheControl: 'public, max-age=60',
      });
    },
  );
  return router;
}
