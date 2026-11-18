import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { withIdempotency } from '../src/shared/idempotency.js';
import {
  bookingRequestMessage,
  clickToChatUrl,
  normalizeWhatsAppNumber,
} from '../src/modules/whatsapp/whatsapp.link.js';
import {
  createWhatsAppService,
  enqueueBookingConfirmation,
} from '../src/modules/whatsapp/whatsapp.service.js';

const baseConfig = {
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  WHATSAPP_APP_SECRET: 'app-secret',
  WHATSAPP_DEFAULT_COUNTRY_CODE: '94',
  WHATSAPP_CONFIRMATION_TEMPLATE: 'booking_confirmed',
  WHATSAPP_TEMPLATE_LANGUAGE: 'en',
  whatsappCloudConfigured: true,
};

describe('WhatsApp click-to-chat helpers', () => {
  it('normalises Sri Lankan and international numbers', () => {
    expect(normalizeWhatsAppNumber('077 123 4567')).toBe('94771234567');
    expect(normalizeWhatsAppNumber('+94 77 123 4567')).toBe('94771234567');
    expect(normalizeWhatsAppNumber('0094771234567')).toBe('94771234567');
    expect(normalizeWhatsAppNumber('12')).toBeNull();
  });

  it('builds an encoded wa.me link without secrets', () => {
    const text = bookingRequestMessage({
      businessName: 'AJ Car Rentals', reference: 'BK-1', vehicleName: 'Toyota Aqua',
      pickupAt: '2026-12-01T04:30:00.000Z', returnAt: '2026-12-02T04:30:00.000Z', customerName: 'Nimal',
    });
    const url = clickToChatUrl('94771234567', text);
    expect(url.startsWith('https://wa.me/94771234567?text=')).toBe(true);
    expect(decodeURIComponent(url)).toContain('Reference: BK-1');
    expect(clickToChatUrl(null, text)).toBeNull();
  });
});

describe('WhatsApp outbox', () => {
  const booking = {
    id: 'b1', whatsappConsent: true, whatsappConsentRevokedAt: null, customerMobileSnapshot: '0771234567',
  };

  it('queues a confirmation only for consented bookings with an automatic provider', async () => {
    const tx = {
      whatsAppMessage: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'm1', ...data })),
      },
    };
    expect(await enqueueBookingConfirmation(tx, { booking: { ...booking, whatsappConsent: false }, config: baseConfig })).toBeNull();
    expect(await enqueueBookingConfirmation(tx, { booking: { ...booking, whatsappConsentRevokedAt: new Date() }, config: baseConfig })).toBeNull();
    expect(await enqueueBookingConfirmation(tx, { booking, config: { ...baseConfig, whatsappCloudConfigured: false } })).toBeNull();
    const queued = await enqueueBookingConfirmation(tx, { booking, config: baseConfig });
    expect(queued.recipient).toBe('94771234567');
    expect(tx.whatsAppMessage.create).toHaveBeenCalledTimes(1);
  });

  it('does not queue twice for the same booking and category', async () => {
    const tx = { whatsAppMessage: { findUnique: vi.fn().mockResolvedValue({ id: 'existing' }), create: vi.fn() } };
    expect((await enqueueBookingConfirmation(tx, { booking, config: baseConfig })).id).toBe('existing');
    expect(tx.whatsAppMessage.create).not.toHaveBeenCalled();
  });

  it('verifies webhook tokens and HMAC signatures', () => {
    const service = createWhatsAppService({ prisma: {}, config: baseConfig });
    expect(service.verifyWebhook({ mode: 'subscribe', token: 'verify-me', challenge: '123' })).toBe('123');
    expect(() => service.verifyWebhook({ mode: 'subscribe', token: 'wrong', challenge: '1' })).toThrow();
    const raw = Buffer.from('{"a":1}');
    const signature = `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`;
    expect(service.verifySignature(raw, signature)).toBe(true);
    expect(service.verifySignature(raw, 'sha256=bad')).toBe(false);
    expect(service.verifySignature(raw, undefined)).toBe(false);
  });

  it('never moves a message backwards when webhook statuses arrive out of order', async () => {
    const message = { id: 'm1', bookingId: 'b1', status: 'DELIVERED', sentAt: null, deliveredAt: null };
    const prisma = {
      whatsAppMessage: {
        findUnique: vi.fn().mockResolvedValue(message),
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn() },
    };
    const service = createWhatsAppService({ prisma, config: baseConfig });
    const payload = (status) => ({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status, timestamp: '1700000000' }] } }] }] });
    expect(await service.applyWebhookPayload(payload('sent'))).toBe(0);
    expect(await service.applyWebhookPayload(payload('read'))).toBe(1);
    expect(prisma.whatsAppMessage.update.mock.calls[0][0].data.status).toBe('READ');
  });

  it('records a retryable provider failure without claiming delivery', async () => {
    const stored = { id: 'm1', bookingId: 'b1', status: 'SENDING', retryCount: 0, recipient: '94771234567', templateName: 't',
      category: 'BOOKING_CONFIRMED', booking: { reference: 'BK-1', pickupAt: new Date(), customerNameSnapshot: 'N', vehicle: null } };
    const prisma = {
      whatsAppMessage: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(stored),
        update: vi.fn().mockImplementation(async ({ data }) => ({ ...stored, ...data })),
      },
      auditLog: { create: vi.fn() },
    };
    const provider = { sendTemplate: vi.fn().mockResolvedValue({ ok: false, retryable: true, code: '131000', message: 'boom' }) };
    const updated = await createWhatsAppService({ prisma, config: baseConfig, provider }).send('m1');
    expect(updated.status).toBe('QUEUED');
    expect(updated.retryCount).toBe(1);
    expect(updated.nextAttemptAt).toBeInstanceOf(Date);
  });
});

describe('idempotency', () => {
  function store() {
    const rows = new Map();
    return {
      idempotencyKey: {
        deleteMany: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const id = `${data.scope}:${data.keyHash}`;
          if (rows.has(id)) throw Object.assign(new Error('dup'), { code: 'P2002' });
          rows.set(id, { ...data, responseBody: null });
        }),
        findUnique: vi.fn().mockImplementation(async ({ where }) => rows.get(`${where.scope_keyHash.scope}:${where.scope_keyHash.keyHash}`)),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          Object.assign(rows.get(`${where.scope_keyHash.scope}:${where.scope_keyHash.keyHash}`), data);
        }),
        delete: vi.fn().mockImplementation(async ({ where }) => { rows.delete(`${where.scope_keyHash.scope}:${where.scope_keyHash.keyHash}`); }),
      },
    };
  }

  it('replays the first response and runs the operation once', async () => {
    const prisma = store();
    const run = vi.fn().mockResolvedValue({ reference: 'BK-1' });
    const args = { scope: 's', key: 'key-12345678', body: { a: 1, b: 2 }, run };
    const first = await withIdempotency(prisma, args);
    const second = await withIdempotency(prisma, { ...args, body: { b: 2, a: 1 } });
    expect(first.replayed).toBe(false);
    expect(second).toEqual({ result: { reference: 'BK-1' }, replayed: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rejects a reused key with a different body and frees the key after a failure', async () => {
    const prisma = store();
    await withIdempotency(prisma, { scope: 's', key: 'key-12345678', body: { a: 1 }, run: async () => ({ ok: true }) });
    await expect(withIdempotency(prisma, { scope: 's', key: 'key-12345678', body: { a: 2 }, run: vi.fn() }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(withIdempotency(prisma, { scope: 's', key: 'key-failing-1', body: {}, run: async () => { throw new Error('x'); } })).rejects.toThrow('x');
    const retry = await withIdempotency(prisma, { scope: 's', key: 'key-failing-1', body: {}, run: async () => ({ ok: 2 }) });
    expect(retry.replayed).toBe(false);
  });
});
