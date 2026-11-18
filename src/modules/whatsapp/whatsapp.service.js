import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../shared/errors.js';
import { writeAudit } from '../../shared/audit.js';
import { formatColombo, normalizeWhatsAppNumber, vehicleLabel } from './whatsapp.link.js';

export const CATEGORY_BOOKING_CONFIRMED = 'BOOKING_CONFIRMED';
const MAX_ATTEMPTS = 5;
const STALE_SENDING_MS = 10 * 60 * 1000;
const STATUS_RANK = { QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4 };
const PROVIDER_STATUS = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };

function safeEqualText(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function backoffMs(attempt) {
  return Math.min(60 * 60 * 1000, 2 ** attempt * 60 * 1000);
}

function sanitizeError(value) {
  return String(value ?? '').replace(/\s+/g, ' ').slice(0, 480);
}

export function createCloudApiProvider(config, fetchImpl = fetch) {
  return {
    name: 'cloud_api',
    async sendTemplate({ to, template, language, parameters }) {
      const url = `https://graph.facebook.com/${config.WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
              name: template,
              language: { code: language },
              components: [{
                type: 'body',
                parameters: parameters.map((text) => ({ type: 'text', text })),
              }],
            },
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        return { ok: false, retryable: true, code: 'NETWORK_ERROR', message: sanitizeError(error?.message) };
      }
      const body = await response.json().catch(() => ({}));
      if (response.ok && body?.messages?.[0]?.id) {
        return { ok: true, providerMessageId: body.messages[0].id };
      }
      const status = response.status;
      return {
        ok: false,
        retryable: status === 429 || status >= 500,
        code: String(body?.error?.code ?? status),
        message: sanitizeError(body?.error?.message ?? `HTTP ${status}`),
      };
    },
  };
}

export function createWhatsAppService({ prisma, config, logger, provider }) {
  const activeProvider = provider ?? (config.whatsappCloudConfigured ? createCloudApiProvider(config) : null);

  async function audit(action, entityId, afterSnapshot, actor, auditContext = {}) {
    await writeAudit(prisma, {
      actorStaffUserId: actor?.id ?? null,
      actorIdentifierSnapshot: actor?.email ?? 'system',
      action,
      entityType: 'WhatsAppMessage',
      entityId,
      ...auditContext,
      afterSnapshot,
    });
  }

  async function send(messageId) {
    const claimed = await prisma.whatsAppMessage.updateMany({
      where: { id: messageId, status: 'QUEUED' },
      data: { status: 'SENDING' },
    });
    if (claimed.count === 0) return null;
    const message = await prisma.whatsAppMessage.findUnique({
      where: { id: messageId },
      include: {
        booking: {
          select: {
            reference: true,
            pickupAt: true,
            customerNameSnapshot: true,
            vehicle: { select: { specification: { select: { make: true, model: true, variant: true } } } },
          },
        },
      },
    });
    if (!activeProvider) {
      return prisma.whatsAppMessage.update({
        where: { id: messageId },
        data: { status: 'FAILED', errorCode: 'PROVIDER_NOT_CONFIGURED', errorMessage: 'WhatsApp Cloud API is not configured.', nextAttemptAt: null },
      });
    }
    const result = await activeProvider.sendTemplate({
      to: message.recipient,
      template: message.templateName,
      language: config.WHATSAPP_TEMPLATE_LANGUAGE,
      parameters: [
        message.booking.customerNameSnapshot,
        message.booking.reference,
        vehicleLabel(message.booking.vehicle?.specification),
        formatColombo(message.booking.pickupAt),
      ],
    });
    if (result.ok) {
      const updated = await prisma.whatsAppMessage.update({
        where: { id: messageId },
        data: {
          status: 'SENT',
          providerMessageId: result.providerMessageId,
          sentAt: new Date(),
          errorCode: null,
          errorMessage: null,
          nextAttemptAt: null,
        },
      });
      await audit('whatsapp.sent', messageId, { bookingId: message.bookingId, category: message.category, status: 'SENT' });
      return updated;
    }
    const attempts = message.retryCount + 1;
    const exhausted = !result.retryable || attempts >= MAX_ATTEMPTS;
    const updated = await prisma.whatsAppMessage.update({
      where: { id: messageId },
      data: {
        status: exhausted ? 'FAILED' : 'QUEUED',
        retryCount: attempts,
        errorCode: String(result.code).slice(0, 80),
        errorMessage: result.message,
        nextAttemptAt: exhausted ? null : new Date(Date.now() + backoffMs(attempts)),
      },
    });
    logger?.warn?.({ messageId, code: result.code }, 'WhatsApp message send failed');
    if (exhausted) {
      await audit('whatsapp.failed', messageId, { bookingId: message.bookingId, category: message.category, errorCode: result.code });
    }
    return updated;
  }

  return {
    send,

    isAutomaticSendingEnabled() {
      return config.whatsappCloudConfigured;
    },

    publicConfig() {
      return {
        businessName: config.BUSINESS_NAME,
        whatsappNumber: normalizeWhatsAppNumber(config.WHATSAPP_BUSINESS_NUMBER, config.WHATSAPP_DEFAULT_COUNTRY_CODE),
      };
    },

    configurationStatus() {
      return {
        provider: config.WHATSAPP_PROVIDER,
        businessNumberConfigured: Boolean(normalizeWhatsAppNumber(config.WHATSAPP_BUSINESS_NUMBER, config.WHATSAPP_DEFAULT_COUNTRY_CODE)),
        cloudApiConfigured: config.whatsappCloudConfigured,
        webhookConfigured: config.whatsappWebhookConfigured,
        confirmationTemplate: config.WHATSAPP_CONFIRMATION_TEMPLATE,
        automaticSending: config.whatsappCloudConfigured,
      };
    },

    async processDue({ limit = 20 } = {}) {
      await prisma.whatsAppMessage.updateMany({
        where: { status: 'SENDING', updatedAt: { lt: new Date(Date.now() - STALE_SENDING_MS) } },
        data: { status: 'QUEUED' },
      });
      const due = await prisma.whatsAppMessage.findMany({
        where: {
          status: 'QUEUED',
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: { id: true },
      });
      for (const { id } of due) await send(id);
      return due.length;
    },

    async retryForBooking({ bookingId, actor, auditContext }) {
      const messages = await prisma.whatsAppMessage.findMany({
        where: { bookingId, status: 'FAILED' },
        select: { id: true },
      });
      if (messages.length === 0) {
        throw new AppError(409, 'WHATSAPP_NOTHING_TO_RETRY', 'There is no failed WhatsApp message to retry for this booking.');
      }
      for (const { id } of messages) {
        await prisma.whatsAppMessage.update({
          where: { id },
          data: { status: 'QUEUED', retryCount: 0, nextAttemptAt: null, errorCode: null, errorMessage: null },
        });
        await audit('whatsapp.retry_requested', id, { bookingId }, actor, auditContext);
        await send(id);
      }
      return prisma.whatsAppMessage.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } });
    },

    verifyWebhook({ mode, token, challenge }) {
      if (mode === 'subscribe' && config.WHATSAPP_VERIFY_TOKEN && safeEqualText(token, config.WHATSAPP_VERIFY_TOKEN)) {
        return String(challenge ?? '');
      }
      throw new AppError(403, 'WEBHOOK_VERIFICATION_FAILED', 'Webhook verification failed.');
    },

    verifySignature(rawBody, signatureHeader) {
      if (!config.WHATSAPP_APP_SECRET || !rawBody || typeof signatureHeader !== 'string') return false;
      const expected = `sha256=${createHmac('sha256', config.WHATSAPP_APP_SECRET).update(rawBody).digest('hex')}`;
      return safeEqualText(signatureHeader, expected);
    },

    async applyWebhookPayload(payload) {
      const statuses = (payload?.entry ?? [])
        .flatMap((entry) => entry?.changes ?? [])
        .flatMap((change) => change?.value?.statuses ?? []);
      let updated = 0;
      for (const item of statuses) {
        const next = PROVIDER_STATUS[item?.status];
        if (!next || !item.id) continue;
        const message = await prisma.whatsAppMessage.findUnique({ where: { providerMessageId: item.id } });
        if (!message) continue;
        if (next !== 'FAILED' && (STATUS_RANK[message.status] ?? 0) >= STATUS_RANK[next]) continue;
        const at = item.timestamp ? new Date(Number(item.timestamp) * 1000) : new Date();
        await prisma.whatsAppMessage.update({
          where: { id: message.id },
          data: next === 'FAILED'
            ? {
                status: 'FAILED',
                errorCode: String(item.errors?.[0]?.code ?? 'DELIVERY_FAILED').slice(0, 80),
                errorMessage: sanitizeError(item.errors?.[0]?.title ?? 'Delivery failed.'),
              }
            : {
                status: next,
                ...(next === 'SENT' ? { sentAt: message.sentAt ?? at } : {}),
                ...(next === 'DELIVERED' ? { deliveredAt: at } : {}),
                ...(next === 'READ' ? { readAt: at, deliveredAt: message.deliveredAt ?? at } : {}),
              },
        });
        await audit(`whatsapp.${next.toLowerCase()}`, message.id, { bookingId: message.bookingId, source: 'webhook' });
        updated += 1;
      }
      return updated;
    },
  };
}

// Queues a confirmation inside the caller's transaction; only for consented bookings and automatic providers.
export async function enqueueBookingConfirmation(tx, { booking, config }) {
  if (!config.whatsappCloudConfigured) return null;
  if (!booking.whatsappConsent || booking.whatsappConsentRevokedAt) return null;
  const recipient = normalizeWhatsAppNumber(booking.customerMobileSnapshot, config.WHATSAPP_DEFAULT_COUNTRY_CODE);
  if (!recipient) return null;
  const existing = await tx.whatsAppMessage.findUnique({
    where: { bookingId_category: { bookingId: booking.id, category: CATEGORY_BOOKING_CONFIRMED } },
  });
  if (existing) return existing;
  return tx.whatsAppMessage.create({
    data: {
      bookingId: booking.id,
      category: CATEGORY_BOOKING_CONFIRMED,
      provider: 'cloud_api',
      templateName: config.WHATSAPP_CONFIRMATION_TEMPLATE,
      recipient,
    },
  });
}
