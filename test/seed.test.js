import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    permission: {
      upsert: vi.fn(async ({ create }) => ({ id: create.code, code: create.code })),
    },
    role: {
      upsert: vi.fn(async ({ create }) => ({ id: create.code })),
    },
    rolePermission: {
      deleteMany: vi.fn(async () => ({})),
      createMany: vi.fn(async () => ({})),
    },
  };
  return {
    transaction: vi.fn(async (callback) => callback(tx)),
    disconnect: vi.fn(async () => {}),
  };
});

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    $transaction = mocks.transaction;
    $disconnect = mocks.disconnect;
  },
}));

it('gives the seed transaction enough time for a remote database', async () => {
  await import('../prisma/seed.js');
  expect(mocks.transaction).toHaveBeenCalledOnce();
  expect(mocks.transaction.mock.calls[0][1].timeout).toBeGreaterThan(5000);
  expect(mocks.disconnect).toHaveBeenCalledOnce();
});
