import { Router } from 'express';
import { requestAuditContext } from '../../shared/audit.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import {
  createStaffSchema,
  createVehicleAssignmentSchema,
  staffIdSchema,
  staffListSchema,
  staffSessionParamsSchema,
  updateStaffProfileSchema,
  updateStaffRolesSchema,
  updateStaffStatusSchema,
  vehicleAssignmentParamsSchema,
} from './staff.schemas.js';

export function createStaffRouter({ staffService, authenticate }) {
  const router = Router();
  router.use(authenticate);

  router.get(
    '/me/vehicle-assignments',
    async (req, res) => {
      const assignments = await staffService.listVehicleAssignments({
        staffUserId: req.auth.staff.id,
        actor: req.auth.staff,
      });
      res.json({ data: assignments });
    },
  );

  router.get(
    '/',
    requirePermission('staff.view'),
    validate(staffListSchema),
    async (req, res) => {
      res.json({ data: await staffService.list(req.validated.query) });
    },
  );

  router.post(
    '/',
    requirePermission('staff.create'),
    validate(createStaffSchema),
    async (req, res) => {
      const result = await staffService.create({
        input: req.validated.body,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.status(201).json({ data: result });
    },
  );

  router.post(
    '/:id/password-token',
    requirePermission('staff.manage'),
    validate(staffIdSchema),
    async (req, res) => {
      const result = await staffService.generatePasswordToken({
        id: req.validated.params.id,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.set('Cache-Control', 'no-store');
      res.status(201).json({ data: result });
    },
  );

  router.delete(
    '/:id/password-token',
    requirePermission('staff.manage'),
    validate(staffIdSchema),
    async (req, res) => {
      const result = await staffService.revokePasswordTokens({
        id: req.validated.params.id,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: result });
    },
  );

  router.get(
    '/:id',
    requirePermission('staff.view'),
    validate(staffIdSchema),
    async (req, res) => {
      res.json({ data: await staffService.getById(req.validated.params.id) });
    },
  );

  router.patch(
    '/:id',
    requirePermission('staff.update'),
    validate(updateStaffProfileSchema),
    async (req, res) => {
      const staff = await staffService.updateProfile({
        id: req.validated.params.id,
        input: req.validated.body,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: staff });
    },
  );

  router.patch(
    '/:id/status',
    requirePermission('staff.deactivate'),
    validate(updateStaffStatusSchema),
    async (req, res) => {
      const staff = await staffService.updateStatus({
        id: req.validated.params.id,
        status: req.validated.body.status,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: staff });
    },
  );

  router.put(
    '/:id/roles',
    requirePermission('staff.roles.assign'),
    validate(updateStaffRolesSchema),
    async (req, res) => {
      const staff = await staffService.updateRoles({
        id: req.validated.params.id,
        roleIds: req.validated.body.roleIds,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: staff });
    },
  );

  router.get(
    '/:id/sessions',
    validate(staffIdSchema),
    async (req, res) => {
      res.json({
        data: await staffService.listSessions({
          id: req.validated.params.id,
          actor: req.auth.staff,
        }),
      });
    },
  );

  router.delete(
    '/:id/sessions/:sessionId',
    validate(staffSessionParamsSchema),
    async (req, res) => {
      res.json({
        data: await staffService.revokeSession({
          staffUserId: req.validated.params.id,
          sessionId: req.validated.params.sessionId,
          actor: req.auth.staff,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  router.get(
    '/:id/vehicle-assignments',
    validate(staffIdSchema),
    async (req, res) => {
      res.json({
        data: await staffService.listVehicleAssignments({
          staffUserId: req.validated.params.id,
          actor: req.auth.staff,
        }),
      });
    },
  );

  router.post(
    '/:id/vehicle-assignments',
    requirePermission('staff.vehicles.assign'),
    validate(createVehicleAssignmentSchema),
    async (req, res) => {
      const assignment = await staffService.assignVehicle({
        staffUserId: req.validated.params.id,
        vehicleId: req.validated.body.vehicleId,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.status(201).json({ data: assignment });
    },
  );

  router.delete(
    '/:id/vehicle-assignments/:assignmentId',
    requirePermission('staff.vehicles.assign'),
    validate(vehicleAssignmentParamsSchema),
    async (req, res) => {
      res.json({
        data: await staffService.revokeVehicleAssignment({
          staffUserId: req.validated.params.id,
          assignmentId: req.validated.params.assignmentId,
          actor: req.auth.staff,
          auditContext: requestAuditContext(req),
        }),
      });
    },
  );

  return router;
}
