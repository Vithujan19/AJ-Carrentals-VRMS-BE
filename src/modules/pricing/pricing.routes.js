import { Router } from 'express';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { requestAuditContext } from '../../shared/audit.js';
import {
  createRentalPackageSchema,
  createVehicleRateSchema,
  rentalPackageListSchema,
  updateRentalPackageSchema,
  updateVehicleRateSchema,
  vehicleRateListSchema,
} from './pricing.schemas.js';

export function createPricingRouter({ pricingService, authenticate }) {
  const router = Router();
  router.use(authenticate);

  router.get(
    '/rental-packages',
    requirePermission('vehicles.pricing.view'),
    validate(rentalPackageListSchema),
    async (req, res) => {
      res.json({
        data: await pricingService.listPackages(req.validated.query.includeInactive),
      });
    },
  );

  router.post(
    '/rental-packages',
    requirePermission('vehicles.pricing.manage'),
    validate(createRentalPackageSchema),
    async (req, res) => {
      const rentalPackage = await pricingService.createPackage({
        input: req.validated.body,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.status(201).json({ data: rentalPackage });
    },
  );

  router.patch(
    '/rental-packages/:packageId',
    requirePermission('vehicles.pricing.manage'),
    validate(updateRentalPackageSchema),
    async (req, res) => {
      const rentalPackage = await pricingService.updatePackage({
        packageId: req.validated.params.packageId,
        input: req.validated.body,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: rentalPackage });
    },
  );

  router.get(
    '/vehicles/:id/rates',
    requirePermission('vehicles.pricing.view'),
    validate(vehicleRateListSchema),
    async (req, res) => {
      res.json({
        data: await pricingService.listRates(
          req.validated.params.id,
          req.validated.query.includeInactive,
        ),
      });
    },
  );

  router.post(
    '/vehicles/:id/rates',
    requirePermission('vehicles.pricing.manage'),
    validate(createVehicleRateSchema),
    async (req, res) => {
      const rate = await pricingService.createRate({
        vehicleId: req.validated.params.id,
        input: req.validated.body,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.status(201).json({ data: rate });
    },
  );

  router.patch(
    '/vehicles/:id/rates/:rateId',
    requirePermission('vehicles.pricing.manage'),
    validate(updateVehicleRateSchema),
    async (req, res) => {
      const rate = await pricingService.updateRate({
        vehicleId: req.validated.params.id,
        rateId: req.validated.params.rateId,
        input: req.validated.body,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: rate });
    },
  );

  return router;
}
