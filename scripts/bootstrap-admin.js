import 'dotenv/config';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { hashPassword, normalizeEmail, validatePassword } from '../src/shared/passwords.js';

const prisma = new PrismaClient();
const inputSchema = z.object({
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().min(1).max(160),
});

async function main() {
  const parsed = inputSchema.parse({
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    displayName: process.env.BOOTSTRAP_ADMIN_NAME,
  });
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  validatePassword(password);
  const passwordHash = await hashPassword(password);
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;

  const staffUser = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM StaffUser FOR UPDATE`;
      if (await tx.staffUser.count() !== 0) {
        throw new Error('Bootstrap refused: a staff account already exists.');
      }
      const adminRole = await tx.role.findUnique({ where: { code: 'ADMIN' } });
      if (!adminRole) {
        throw new Error('Bootstrap refused: run the reviewed permission seed before this command.');
      }
      const created = await tx.staffUser.create({
        data: {
          emailNormalized: normalizeEmail(parsed.email),
          displayName: parsed.displayName,
          passwordHash,
          roleAssignments: { create: [{ roleId: adminRole.id }] },
        },
        select: { id: true, emailNormalized: true, displayName: true },
      });
      await tx.auditLog.create({
        data: {
          actorIdentifierSnapshot: 'bootstrap-cli',
          action: 'staff.bootstrap_created',
          entityType: 'StaffUser',
          entityId: created.id,
          afterSnapshot: { roleCode: 'ADMIN' },
        },
      });
      return created;
    },
    { isolationLevel: 'Serializable' },
  );
  process.stdout.write(`Initial administrator created: ${staffUser.emailNormalized}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  await prisma.$disconnect();
}
