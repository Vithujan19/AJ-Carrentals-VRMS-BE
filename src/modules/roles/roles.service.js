import { writeAudit } from '../../shared/audit.js';
import { AppError } from '../../shared/errors.js';
import { permissionDescriptions } from '../../shared/permissions.js';

async function ensureActiveAdministrator(tx) {
  await tx.$queryRaw`SELECT id FROM StaffUser WHERE status = 'ACTIVE' FOR UPDATE`;
  const activeUsers = await tx.staffUser.findMany({
    where: { status: 'ACTIVE' },
    include: {
      roleAssignments: {
        include: {
          role: {
            include: { permissionLinks: { include: { permission: true } } },
          },
        },
      },
    },
  });
  const administratorExists = activeUsers.some((staffUser) => {
    const granted = new Set(
      staffUser.roleAssignments.flatMap(({ role }) =>
        role.permissionLinks.map(({ permission }) => permission.code),
      ),
    );
    return (
      granted.has('staff.manage') &&
      granted.has('roles.manage') &&
      granted.has('staff.roles.assign_privileged')
    );
  });
  if (!administratorExists) {
    throw new AppError(
      409,
      'FINAL_ADMINISTRATOR_REQUIRED',
      'At least one active administrator must retain staff and role management permissions.',
    );
  }
}

export function createRolesService({ prisma }) {
  return {
    async list() {
      const roles = await prisma.role.findMany({
        include: {
          permissionLinks: {
            include: { permission: { select: { id: true, code: true, description: true } } },
          },
          _count: { select: { staffLinks: true } },
        },
        orderBy: [{ code: 'asc' }],
      });
      return roles.map(({ permissionLinks, _count, ...role }) => ({
        ...role,
        staffCount: _count.staffLinks,
        permissions: permissionLinks
          .map(({ permission }) => permission)
          .sort((left, right) => left.code.localeCompare(right.code)),
      }));
    },

    async listPermissions() {
      const records = await prisma.permission.findMany({
        orderBy: { code: 'asc' },
        select: { id: true, code: true, description: true },
      });
      return records.map((permission) => ({
        ...permission,
        description: permissionDescriptions[permission.code] ?? permission.description,
      }));
    },

    async updatePermissions({ roleId, permissionCodes, actor, auditContext }) {
      const requestedCodes = [...new Set(permissionCodes)];
      const requested = await prisma.permission.findMany({
        where: { code: { in: requestedCodes } },
        select: { id: true, code: true },
      });
      if (requested.length !== requestedCodes.length) {
        throw new AppError(
          400,
          'INVALID_PERMISSION_ASSIGNMENT',
          'One or more requested permissions are invalid.',
        );
      }
      const actorPermissions = new Set(actor.permissions);
      const canAssignPrivileged = actorPermissions.has('staff.roles.assign_privileged');
      if (requested.some(({ code }) => !actorPermissions.has(code)) && !canAssignPrivileged) {
        throw new AppError(
          403,
          'PERMISSION_ASSIGNMENT_DENIED',
          'You cannot grant permissions you do not have.',
        );
      }

      return prisma.$transaction(
        async (tx) => {
          const role = await tx.role.findUnique({
            where: { id: roleId },
            include: {
              permissionLinks: { include: { permission: { select: { code: true } } } },
            },
          });
          if (!role) {
            throw new AppError(404, 'ROLE_NOT_FOUND', 'Role was not found.');
          }
          const previousCodes = role.permissionLinks
            .map(({ permission }) => permission.code)
            .sort();
          if (
            previousCodes.some((code) => !actorPermissions.has(code)) &&
            !canAssignPrivileged
          ) {
            throw new AppError(
              403,
              'PRIVILEGED_ROLE_MANAGEMENT_DENIED',
              'You cannot modify a role containing permissions above your own.',
            );
          }
          const nextCodes = requested.map(({ code }) => code).sort();
          const affectedStaff = await tx.staffRole.findMany({
            where: { roleId },
            select: { staffUserId: true },
          });

          await tx.rolePermission.deleteMany({ where: { roleId } });
          if (requested.length) {
            await tx.rolePermission.createMany({
              data: requested.map(({ id }) => ({ roleId, permissionId: id })),
            });
          }
          await ensureActiveAdministrator(tx);
          if (affectedStaff.length) {
            await tx.staffSession.updateMany({
              where: {
                staffUserId: { in: affectedStaff.map(({ staffUserId }) => staffUserId) },
                revokedAt: null,
              },
              data: { revokedAt: new Date() },
            });
          }
          await writeAudit(tx, {
            actorStaffUserId: actor.id,
            actorIdentifierSnapshot: actor.email,
            action: 'role.permissions_changed',
            entityType: 'Role',
            entityId: roleId,
            ...auditContext,
            beforeSnapshot: { permissionCodes: previousCodes },
            afterSnapshot: { permissionCodes: nextCodes },
          });
          return {
            id: role.id,
            code: role.code,
            permissionCodes: nextCodes,
          };
        },
        { isolationLevel: 'Serializable' },
      );
    },
  };
}
