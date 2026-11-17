import { writeAudit } from '../../shared/audit.js';
import { AppError } from '../../shared/errors.js';
import { createOpaqueToken, hashOpaqueToken } from '../../shared/passwords.js';
import { STAFF_AUTH_TRANSACTION_OPTIONS } from '../../shared/staff-auth-transaction.js';
import { publicStaff } from '../auth/auth.service.js';

const staffInclude = {
  roleAssignments: {
    include: {
      role: { include: { permissionLinks: { include: { permission: true } } } },
    },
  },
};

function effectivePermissions(staffUser) {
  return new Set(
    staffUser.roleAssignments.flatMap(({ role }) =>
      role.permissionLinks.map(({ permission }) => permission.code),
    ),
  );
}

function auditActor(actor) {
  return {
    actorStaffUserId: actor.id,
    actorIdentifierSnapshot: actor.email,
  };
}

async function loadRoles(tx, roleIds) {
  const distinctRoleIds = [...new Set(roleIds)];
  const roles = await tx.role.findMany({
    where: { id: { in: distinctRoleIds } },
    include: { permissionLinks: { include: { permission: true } } },
  });
  if (roles.length !== distinctRoleIds.length) {
    throw new AppError(400, 'INVALID_ROLE_ASSIGNMENT', 'One or more requested roles are invalid.');
  }
  return roles;
}

function assertGrantableRoles(roles, actor, privilegedAssignmentAllowed) {
  const actorPermissions = new Set(actor.permissions);
  const requestedPermissions = new Set(
    roles.flatMap((role) => role.permissionLinks.map(({ permission }) => permission.code)),
  );
  const grantsAdditionalPermissions = [...requestedPermissions].some(
    (permission) => !actorPermissions.has(permission),
  );
  if (grantsAdditionalPermissions && !privilegedAssignmentAllowed) {
    throw new AppError(403, 'ROLE_ASSIGNMENT_DENIED', 'You cannot grant permissions you do not have.');
  }
}

function hasAdministratorPermissions(staffUser) {
  const current = effectivePermissions(staffUser);
  return (
    current.has('staff.manage') &&
    current.has('roles.manage') &&
    current.has('staff.roles.assign_privileged')
  );
}

function assertCanManageTarget(actor, target) {
  if (target.id === actor.id || actor.permissions.includes('staff.roles.assign_privileged')) {
    return;
  }
  const actorPermissions = new Set(actor.permissions);
  const targetPermissions = effectivePermissions(target);
  if ([...targetPermissions].some((permission) => !actorPermissions.has(permission))) {
    throw new AppError(
      403,
      'PRIVILEGED_STAFF_MANAGEMENT_DENIED',
      'You cannot modify a staff account with permissions above your own.',
    );
  }
}

async function preventRemovingFinalAdministrator(tx, staffUserId, remainsAdministrator) {
  await tx.$queryRaw`SELECT id FROM StaffUser WHERE status = 'ACTIVE' FOR UPDATE`;
  const activeUsers = await tx.staffUser.findMany({
    where: { status: 'ACTIVE' },
    include: staffInclude,
  });
  const administrators = activeUsers.filter(hasAdministratorPermissions);
  const targetIsAdministrator = administrators.some(({ id }) => id === staffUserId);
  if (targetIsAdministrator && !remainsAdministrator && administrators.length <= 1) {
    throw new AppError(
      409,
      'FINAL_ADMINISTRATOR_REQUIRED',
      'The final active administrator cannot be deactivated or lose administrative permissions.',
    );
  }
}

function translateUniqueError(error) {
  if (error?.code === 'P2002') {
    throw new AppError(409, 'DUPLICATE_STAFF_EMAIL', 'A staff account with that email already exists.');
  }
  throw error;
}

export function createStaffService({ prisma, config }) {
  return {
    async list({ page, limit, search, status }) {
      const where = {
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { displayName: { contains: search } },
                { emailNormalized: { contains: search.trim().toLowerCase() } },
              ],
            }
          : {}),
      };
      const [items, total] = await prisma.$transaction([
        prisma.staffUser.findMany({
          where,
          include: staffInclude,
          orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.staffUser.count({ where }),
      ]);
      return {
        items: items.map(publicStaff),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    },

    async getById(id) {
      const staffUser = await prisma.staffUser.findUnique({
        where: { id },
        include: staffInclude,
      });
      if (!staffUser) {
        throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff account was not found.');
      }
      return publicStaff(staffUser);
    },

    async create({ input, actor, auditContext }) {
      const roleIds = [...new Set(input.roleIds)];
      let created;
      try {
        created = await prisma.$transaction(async (tx) => {
          const roles = await loadRoles(tx, roleIds);
          assertGrantableRoles(
            roles,
            actor,
            actor.permissions.includes('staff.roles.assign_privileged'),
          );
          const staffUser = await tx.staffUser.create({
            data: {
              emailNormalized: input.email.trim().toLowerCase(),
              displayName: input.displayName.trim(),
              mobileNumber: input.mobileNumber ?? null,
              passwordHash: null,
              status: 'PENDING_SETUP',
              roleAssignments: {
                create: roles.map((role) => ({ roleId: role.id })),
              },
            },
            include: staffInclude,
          });
          await writeAudit(tx, {
            ...auditActor(actor),
            action: 'staff.created',
            entityType: 'StaffUser',
            entityId: staffUser.id,
            ...auditContext,
            afterSnapshot: { roleIds: roles.map(({ id }) => id), status: staffUser.status },
          });
          return staffUser;
        }, STAFF_AUTH_TRANSACTION_OPTIONS);
      } catch (error) {
        translateUniqueError(error);
      }

      return { staff: publicStaff(created) };
    },

    async generatePasswordToken({ id, actor, auditContext }) {
      const rawToken = createOpaqueToken();
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM StaffUser WHERE id = ${id} FOR UPDATE`;
        const staffUser = await tx.staffUser.findUnique({ where: { id }, include: staffInclude });
        if (!staffUser) {
          throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff account was not found.');
        }
        assertCanManageTarget(actor, staffUser);
        if (!['ACTIVE', 'PENDING_SETUP'].includes(staffUser.status)) {
          throw new AppError(409, 'STAFF_NOT_ELIGIBLE', 'This staff account cannot receive a password token.');
        }
        const purpose = staffUser.status === 'PENDING_SETUP' ? 'SETUP' : 'RESET';
        const now = new Date();
        const expiresAt = new Date(now.getTime() + config.PASSWORD_RESET_TTL_SECONDS * 1000);
        await tx.staffPasswordResetToken.updateMany({
          where: { staffUserId: id, purpose, usedAt: null, invalidatedAt: null },
          data: { invalidatedAt: now },
        });
        await tx.staffPasswordResetToken.create({
          data: {
            staffUserId: id,
            tokenHash: hashOpaqueToken(rawToken),
            purpose,
            expiresAt,
            requestedIp: auditContext.ipAddress,
          },
        });
        await writeAudit(tx, {
          ...auditActor(actor),
          action: 'staff.password_token_generated',
          entityType: 'StaffUser',
          entityId: id,
          ...auditContext,
          afterSnapshot: { purpose, expiresAt: expiresAt.toISOString() },
        });
        return { token: rawToken, purpose, expiresAt };
      }, STAFF_AUTH_TRANSACTION_OPTIONS);
    },

    async revokePasswordTokens({ id, actor, auditContext }) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM StaffUser WHERE id = ${id} FOR UPDATE`;
        const staffUser = await tx.staffUser.findUnique({ where: { id }, include: staffInclude });
        if (!staffUser) {
          throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff account was not found.');
        }
        assertCanManageTarget(actor, staffUser);
        const result = await tx.staffPasswordResetToken.updateMany({
          where: { staffUserId: id, usedAt: null, invalidatedAt: null },
          data: { invalidatedAt: new Date() },
        });
        await writeAudit(tx, {
          ...auditActor(actor),
          action: 'staff.password_tokens_revoked',
          entityType: 'StaffUser',
          entityId: id,
          ...auditContext,
          afterSnapshot: { revokedCount: result.count },
        });
        return { revokedCount: result.count };
      }, STAFF_AUTH_TRANSACTION_OPTIONS);
    },

    async updateProfile({ id, input, actor, auditContext }) {
      const existing = await prisma.staffUser.findUnique({
        where: { id },
        include: staffInclude,
      });
      if (!existing) {
        throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff account was not found.');
      }
      assertCanManageTarget(actor, existing);
      const data = {
        ...(input.displayName === undefined ? {} : { displayName: input.displayName.trim() }),
        ...(input.email === undefined
          ? {}
          : { emailNormalized: input.email.trim().toLowerCase() }),
        ...(input.mobileNumber === undefined ? {} : { mobileNumber: input.mobileNumber }),
      };
      if (Object.keys(data).length === 0) {
        throw new AppError(400, 'NO_CHANGES', 'Provide at least one profile field to update.');
      }
      try {
        const result = await prisma.$transaction(async (tx) => {
          const staffUser = await tx.staffUser.update({
            where: { id },
            data,
            include: staffInclude,
          });
          if (data.emailNormalized !== undefined) {
            await tx.staffPasswordResetToken.updateMany({
              where: { staffUserId: id, usedAt: null, invalidatedAt: null },
              data: { invalidatedAt: new Date() },
            });
          }
          await writeAudit(tx, {
            ...auditActor(actor),
            action: 'staff.profile_updated',
            entityType: 'StaffUser',
            entityId: id,
            ...auditContext,
            afterSnapshot: { changedFields: Object.keys(data) },
          });
          return staffUser;
        });
        return publicStaff(result);
      } catch (error) {
        translateUniqueError(error);
      }
    },

    async updateRoles({ id, roleIds, actor, auditContext }) {
      if (id === actor.id) {
        throw new AppError(403, 'SELF_PRIVILEGE_CHANGE_DENIED', 'You cannot change your own roles.');
      }
      return prisma.$transaction(
        async (tx) => {
          const existing = await tx.staffUser.findUnique({
            where: { id },
            include: staffInclude,
          });
          if (!existing) {
            throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff account was not found.');
          }
          assertCanManageTarget(actor, existing);
          const roles = await loadRoles(tx, roleIds);
          assertGrantableRoles(
            roles,
            actor,
            actor.permissions.includes('staff.roles.assign_privileged'),
          );
          const willRemainAdmin = roles.some((role) =>
            role.permissionLinks.some(({ permission }) => permission.code === 'staff.manage'),
          ) && roles.some((role) =>
            role.permissionLinks.some(({ permission }) => permission.code === 'roles.manage'),
          ) && roles.some((role) =>
            role.permissionLinks.some(({ permission }) => permission.code === 'staff.roles.assign_privileged'),
          );
          const retainsAssignedVehicleAccess = roles.some((role) =>
            role.permissionLinks.some(({ permission }) => permission.code === 'vehicles.view.assigned'),
          );
          await preventRemovingFinalAdministrator(tx, id, willRemainAdmin);
          await tx.staffRole.deleteMany({ where: { staffUserId: id } });
          await tx.staffRole.createMany({
            data: roles.map((role) => ({ staffUserId: id, roleId: role.id })),
          });
          await tx.staffSession.updateMany({
            where: { staffUserId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          if (!retainsAssignedVehicleAccess) {
            await tx.vehicleStaffAssignment.updateMany({
              where: { staffUserId: id, revokedAt: null },
              data: { revokedAt: new Date(), revokedByStaffId: actor.id },
            });
          }
          const updated = await tx.staffUser.findUnique({
            where: { id },
            include: staffInclude,
          });
          await writeAudit(tx, {
            ...auditActor(actor),
            action: 'staff.roles_changed',
            entityType: 'StaffUser',
            entityId: id,
            ...auditContext,
            beforeSnapshot: { roleIds: existing.roleAssignments.map(({ role }) => role.id) },
            afterSnapshot: { roleIds: roles.map(({ id: roleId }) => roleId) },
          });
          return publicStaff(updated);
        },
        { isolationLevel: 'Serializable' },
      );
    },

    async updateStatus({ id, status, actor, auditContext }) {
      if (id === actor.id) {
        throw new AppError(403, 'SELF_STATUS_CHANGE_DENIED', 'You cannot change your own account status.');
      }
      return prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM StaffUser WHERE id = ${id} FOR UPDATE`;
          const existing = await tx.staffUser.findUnique({
            where: { id },
            include: staffInclude,
          });
          if (!existing) {
            throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff account was not found.');
          }
          assertCanManageTarget(actor, existing);
          const nextStatus = status === 'ACTIVE' && !existing.passwordHash ? 'PENDING_SETUP' : status;
          const remainsAdmin = nextStatus === 'ACTIVE' && hasAdministratorPermissions(existing);
          await preventRemovingFinalAdministrator(tx, id, remainsAdmin);
          const now = new Date();
          const updated = await tx.staffUser.update({
            where: { id },
            data: {
              status: nextStatus,
              deactivatedAt: ['ACTIVE', 'PENDING_SETUP'].includes(nextStatus) ? null : now,
            },
            include: staffInclude,
          });
          if (nextStatus !== 'ACTIVE') {
            await tx.staffSession.updateMany({
              where: { staffUserId: id, revokedAt: null },
              data: { revokedAt: now },
            });
          }
          let revokedAssignmentCount = 0;
          if (nextStatus !== 'ACTIVE') {
            const assignments = await tx.vehicleStaffAssignment.updateMany({
              where: { staffUserId: id, revokedAt: null },
              data: { revokedAt: now, revokedByStaffId: actor.id },
            });
            revokedAssignmentCount = assignments.count;
            await tx.staffPasswordResetToken.updateMany({
              where: { staffUserId: id, usedAt: null, invalidatedAt: null },
              data: { invalidatedAt: now },
            });
          }
          await writeAudit(tx, {
            ...auditActor(actor),
            action: nextStatus === 'ACTIVE'
              ? 'staff.activated'
              : nextStatus === 'PENDING_SETUP'
                ? 'staff.password_setup_pending'
                : 'staff.deactivated',
            entityType: 'StaffUser',
            entityId: id,
            ...auditContext,
            beforeSnapshot: { status: existing.status },
            afterSnapshot: { status: nextStatus, revokedAssignmentCount },
          });
          return publicStaff(updated);
        },
        { isolationLevel: 'Serializable' },
      );
    },

    async listSessions({ id, actor }) {
      if (id !== actor.id && !actor.permissions.includes('staff.sessions.manage')) {
        throw new AppError(403, 'PERMISSION_DENIED', 'You cannot view these sessions.');
      }
      const staffUser = await prisma.staffUser.findUnique({
        where: { id },
        include: staffInclude,
      });
      if (!staffUser) {
        throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff account was not found.');
      }
      assertCanManageTarget(actor, staffUser);
      return prisma.staffSession.findMany({
        where: { staffUserId: id },
        select: {
          id: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
          ipAddress: true,
          userAgent: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    },

    async revokeSession({ staffUserId, sessionId, actor, auditContext }) {
      if (staffUserId !== actor.id && !actor.permissions.includes('staff.sessions.manage')) {
        throw new AppError(403, 'PERMISSION_DENIED', 'You cannot revoke this session.');
      }
      return prisma.$transaction(async (tx) => {
        const staffUser = await tx.staffUser.findUnique({
          where: { id: staffUserId },
          include: staffInclude,
        });
        if (!staffUser) {
          throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff account was not found.');
        }
        assertCanManageTarget(actor, staffUser);
        const session = await tx.staffSession.findFirst({
          where: { id: sessionId, staffUserId },
          select: { id: true, revokedAt: true },
        });
        if (!session) {
          throw new AppError(404, 'SESSION_NOT_FOUND', 'Session was not found.');
        }
        if (!session.revokedAt) {
          await tx.staffSession.update({
            where: { id: sessionId },
            data: { revokedAt: new Date() },
          });
          await writeAudit(tx, {
            ...auditActor(actor),
            action: 'auth.session_revoked',
            entityType: 'StaffSession',
            entityId: sessionId,
            ...auditContext,
          });
        }
        return { revoked: true };
      });
    },

    async listVehicleAssignments({ staffUserId, actor }) {
      if (
        staffUserId !== actor.id &&
        !actor.permissions.includes('staff.vehicles.view_assignments')
      ) {
        throw new AppError(403, 'PERMISSION_DENIED', 'You cannot view these vehicle assignments.');
      }
      return prisma.vehicleStaffAssignment.findMany({
        where: {
          staffUserId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        include: {
          vehicle: {
            select: {
              id: true,
              registrationNumber: true,
              status: true,
              specification: { select: { make: true, model: true, variant: true } },
            },
          },
        },
        orderBy: { assignedAt: 'desc' },
      });
    },

    async assignVehicle({ staffUserId, vehicleId, actor, auditContext }) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM StaffUser WHERE id = ${staffUserId} FOR UPDATE`;
        const [staffUser, vehicle] = await Promise.all([
          tx.staffUser.findUnique({ where: { id: staffUserId }, select: { id: true, status: true } }),
          tx.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, status: true } }),
        ]);
        if (!staffUser || staffUser.status !== 'ACTIVE') {
          throw new AppError(404, 'ACTIVE_STAFF_NOT_FOUND', 'Active staff account was not found.');
        }
        if (!vehicle || vehicle.status === 'RETIRED') {
          throw new AppError(404, 'AVAILABLE_VEHICLE_NOT_FOUND', 'Vehicle was not found.');
        }
        const existing = await tx.vehicleStaffAssignment.findFirst({
          where: {
            staffUserId,
            vehicleId,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: { id: true },
        });
        if (existing) {
          throw new AppError(409, 'ASSIGNMENT_EXISTS', 'This vehicle is already assigned to the staff member.');
        }
        const assignment = await tx.vehicleStaffAssignment.create({
          data: {
            staffUserId,
            vehicleId,
            assignedByStaffId: actor.id,
          },
        });
        await writeAudit(tx, {
          ...auditActor(actor),
          action: 'staff.vehicle_assigned',
          entityType: 'VehicleStaffAssignment',
          entityId: assignment.id,
          ...auditContext,
          afterSnapshot: { staffUserId, vehicleId },
        });
        return assignment;
      });
    },

    async revokeVehicleAssignment({ staffUserId, assignmentId, actor, auditContext }) {
      return prisma.$transaction(async (tx) => {
        const assignment = await tx.vehicleStaffAssignment.findFirst({
          where: { id: assignmentId, staffUserId, revokedAt: null },
          select: { id: true, vehicleId: true },
        });
        if (!assignment) {
          throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Active vehicle assignment was not found.');
        }
        await tx.vehicleStaffAssignment.update({
          where: { id: assignmentId },
          data: { revokedAt: new Date(), revokedByStaffId: actor.id },
        });
        await writeAudit(tx, {
          ...auditActor(actor),
          action: 'staff.vehicle_assignment_revoked',
          entityType: 'VehicleStaffAssignment',
          entityId: assignmentId,
          ...auditContext,
          beforeSnapshot: { staffUserId, vehicleId: assignment.vehicleId },
        });
        return { revoked: true };
      });
    },
  };
}
