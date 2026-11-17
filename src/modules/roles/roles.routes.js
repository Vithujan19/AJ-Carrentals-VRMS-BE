import { Router } from 'express';
import { requestAuditContext } from '../../shared/audit.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { updateRolePermissionsSchema } from './roles.schemas.js';

export function createRolesRouter({ rolesService, authenticate }) {
  const router = Router();
  router.use(authenticate);
  router.get('/', requirePermission('roles.view'), async (_req, res) => {
    res.json({ data: await rolesService.list() });
  });
  router.get('/permissions', requirePermission('roles.view'), async (_req, res) => {
    res.json({ data: await rolesService.listPermissions() });
  });
  router.put(
    '/:id/permissions',
    requirePermission('roles.manage'),
    validate(updateRolePermissionsSchema),
    async (req, res) => {
      const result = await rolesService.updatePermissions({
        roleId: req.validated.params.id,
        permissionCodes: req.validated.body.permissionCodes,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data: result });
    },
  );
  return router;
}
