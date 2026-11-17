import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  permissionDescriptions,
  permissions,
  roleTemplates,
} from '../src/shared/permissions.js';

const prisma = new PrismaClient();
const roleDetails = {
  ADMIN: { name: 'Administrator', description: 'Full access to staff and business operations.' },
  MANAGER: { name: 'Manager', description: 'Operational management access.' },
  MAINTAINER: { name: 'Maintainer', description: 'Assigned fleet and maintenance access.' },
};

try {
  await prisma.$transaction(async (tx) => {
    const permissionRecords = await Promise.all(
      permissions.map((code) =>
        tx.permission.upsert({
          where: { code },
          update: { description: permissionDescriptions[code] },
          create: { code, description: permissionDescriptions[code] },
        }),
      ),
    );
    const permissionByCode = new Map(
      permissionRecords.map((permission) => [permission.code, permission.id]),
    );

    for (const [code, permissionCodes] of Object.entries(roleTemplates)) {
      const role = await tx.role.upsert({
        where: { code },
        update: { name: roleDetails[code].name, description: roleDetails[code].description, isSystem: true },
        create: {
          code,
          name: roleDetails[code].name,
          description: roleDetails[code].description,
          isSystem: true,
        },
      });
      const permissionIds = [...permissionCodes].map((permissionCode) =>
        permissionByCode.get(permissionCode),
      );
      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: permissionIds } },
      });
      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
  }, { timeout: 120_000 });
  process.stdout.write('Permission catalog and system roles synchronized.\n');
} finally {
  await prisma.$disconnect();
}
