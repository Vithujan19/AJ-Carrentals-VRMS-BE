import { Router } from 'express';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { auditListSchema } from './audit.schemas.js';

export function createAuditRouter({ auditService, authenticate }) {
  const router = Router();
  router.use(authenticate, requirePermission('audit_logs.view'));
  router.get('/', validate(auditListSchema), async (req, res) => {
    res.json({ data: await auditService.list(req.validated.query) });
  });
  return router;
}
