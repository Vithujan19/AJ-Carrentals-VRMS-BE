import { createHash } from 'node:crypto';
import { AppError } from './errors.js';

const TTL_MS = 24 * 60 * 60 * 1000;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Replays the stored response for a repeated key; rejects a reused key with a different body.
export async function withIdempotency(prisma, { scope, key, body, run }) {
  if (!key) return { result: await run(), replayed: false };
  const keyHash = sha256(key);
  const requestHash = sha256(stableStringify(body));
  const now = new Date();

  await prisma.idempotencyKey.deleteMany({ where: { scope, keyHash, expiresAt: { lt: now } } });

  try {
    await prisma.idempotencyKey.create({
      data: { scope, keyHash, requestHash, expiresAt: new Date(now.getTime() + TTL_MS) },
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const existing = await prisma.idempotencyKey.findUnique({
      where: { scope_keyHash: { scope, keyHash } },
    });
    if (!existing || existing.requestHash !== requestHash) {
      throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request.');
    }
    if (!existing.responseBody) {
      throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'This request is still being processed. Try again shortly.');
    }
    return { result: existing.responseBody, replayed: true };
  }

  try {
    const result = await run();
    await prisma.idempotencyKey.update({
      where: { scope_keyHash: { scope, keyHash } },
      data: { responseBody: result, bookingId: result?.bookingId ?? null },
    });
    return { result, replayed: false };
  } catch (error) {
    await prisma.idempotencyKey.delete({ where: { scope_keyHash: { scope, keyHash } } }).catch(() => {});
    throw error;
  }
}
