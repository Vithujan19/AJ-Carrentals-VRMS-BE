import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { requestAuditContext } from '../../shared/audit.js';

export function createWhatsAppWebhookRouter({ whatsappService }) {
  const router = Router();

  router.get('/', (req, res) => {
    const challenge = whatsappService.verifyWebhook({
      mode: req.query['hub.mode'],
      token: req.query['hub.verify_token'],
      challenge: req.query['hub.challenge'],
    });
    res.type('text/plain').send(challenge);
  });

  router.post('/', async (req, res) => {
    if (!whatsappService.verifySignature(req.rawBody, req.get('x-hub-signature-256'))) {
      res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature.' } });
      return;
    }
    await whatsappService.applyWebhookPayload(req.body);
    res.sendStatus(200);
  });

  return router;
}

export function createWhatsAppRouter({ whatsappService, authenticate }) {
  const router = Router();
  router.use(authenticate);

  router.get('/status', requirePermission('whatsapp.manage'), (_req, res) => {
    res.json({ data: whatsappService.configurationStatus() });
  });

  router.post(
    '/bookings/:id/retry',
    requirePermission('whatsapp.manage'),
    validate(z.object({ params: z.object({ id: z.string().uuid() }) })),
    async (req, res) => {
      const data = await whatsappService.retryForBooking({
        bookingId: req.validated.params.id,
        actor: req.auth.staff,
        auditContext: requestAuditContext(req),
      });
      res.json({ data });
    },
  );

  return router;
}
