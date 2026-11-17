import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { writeAudit } from '../../shared/audit.js';
import { AppError } from '../../shared/errors.js';
import { STAFF_AUTH_TRANSACTION_OPTIONS } from '../../shared/staff-auth-transaction.js';
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  validatePassword,
  verifyPassword,
} from '../../shared/passwords.js';

const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const INVALID_CREDENTIALS = new AppError(
  401,
  'INVALID_CREDENTIALS',
  'Email or password is incorrect.',
);

function hashIdentifier(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function publicStaff(staffUser) {
  const permissions = new Set();
  const roles = staffUser.roleAssignments.map(({ role }) => {
    for (const { permission } of role.permissionLinks) {
      permissions.add(permission.code);
    }
    return { id: role.id, code: role.code, name: role.name };
  });

  return {
    id: staffUser.id,
    displayName: staffUser.displayName,
    email: staffUser.emailNormalized,
    mobileNumber: staffUser.mobileNumber,
    status: staffUser.status,
    lastLoginAt: staffUser.lastLoginAt,
    createdAt: staffUser.createdAt,
    roles,
    permissions: [...permissions].sort(),
  };
}

function staffWithAccess(includeSessions = false) {
  return {
    ...(includeSessions ? { sessions: true } : {}),
    roleAssignments: {
      include: {
        role: {
          include: {
            permissionLinks: { include: { permission: true } },
          },
        },
      },
    },
  };
}

export function createAuthService({ prisma, config }) {
  const dummyPasswordHashPromise = argon2.hash(
    randomBytes(32).toString('base64url'),
    { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 },
  );

  async function recordFailedLogin(staffUser, auditContext, countFailure) {
    await prisma.$transaction(async (tx) => {
      let nextFailureCount = null;
      if (staffUser && countFailure) {
        await tx.$queryRaw`SELECT id FROM StaffUser WHERE id = ${staffUser.id} FOR UPDATE`;
        const current = await tx.staffUser.findUnique({
          where: { id: staffUser.id },
          select: { failedLoginCount: true, lockedUntil: true },
        });
        if (current && (!current.lockedUntil || current.lockedUntil <= new Date())) {
          nextFailureCount = current.failedLoginCount + 1;
          await tx.staffUser.update({
            where: { id: staffUser.id },
            data: {
              failedLoginCount: { increment: 1 },
              lastFailedLoginAt: new Date(),
              ...(nextFailureCount >= MAX_FAILED_LOGINS
                ? { lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
                : {}),
            },
          });
        }
      }

      await writeAudit(tx, {
        action: 'auth.login_failed',
        entityType: staffUser ? 'StaffUser' : 'AuthenticationAttempt',
        entityId: staffUser?.id ?? hashIdentifier(auditContext.ipAddress ?? 'unknown'),
        ...auditContext,
        afterSnapshot: {
          outcome: 'failure',
          ...(nextFailureCount === null ? {} : { failedLoginCount: nextFailureCount }),
        },
      });
    });
  }

  async function createSession(tx, staffUserId, auditContext) {
    const rawToken = createOpaqueToken();
    const now = new Date();
    const session = await tx.staffSession.create({
      data: {
        staffUserId,
        tokenHash: hashOpaqueToken(rawToken),
        createdAt: now,
        expiresAt: new Date(now.getTime() + config.SESSION_TTL_SECONDS * 1000),
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
      },
    });
    return { rawToken, session };
  }

  return {
    async login({ email, password, auditContext }) {
      const emailNormalized = normalizeEmail(email);
      const staffUser = await prisma.staffUser.findUnique({
        where: { emailNormalized },
        include: staffWithAccess(),
      });
      const activeAndUnlocked =
        staffUser?.status === 'ACTIVE' &&
        Boolean(staffUser.passwordHash) &&
        (!staffUser.lockedUntil || staffUser.lockedUntil <= new Date());
      const candidateHash = activeAndUnlocked
        ? staffUser.passwordHash
        : await dummyPasswordHashPromise;
      const passwordMatches = await verifyPassword(candidateHash, password);

      if (!activeAndUnlocked || !passwordMatches) {
        const shouldCount =
          staffUser?.status === 'ACTIVE' &&
          (!staffUser.lockedUntil || staffUser.lockedUntil <= new Date());
        await recordFailedLogin(staffUser, auditContext, shouldCount);
        throw INVALID_CREDENTIALS;
      }

      const result = await prisma.$transaction(async (tx) => {
        const now = new Date();
        await tx.$queryRaw`SELECT id FROM StaffUser WHERE id = ${staffUser.id} FOR UPDATE`;
        const current = await tx.staffUser.findUnique({
          where: { id: staffUser.id },
          select: { status: true, passwordHash: true, lockedUntil: true },
        });
        if (
          !current ||
          current.status !== 'ACTIVE' ||
          current.passwordHash !== staffUser.passwordHash ||
          (current.lockedUntil && current.lockedUntil > now)
        ) {
          throw INVALID_CREDENTIALS;
        }
        await tx.staffUser.update({
          where: { id: staffUser.id },
          data: {
            failedLoginCount: 0,
            lastFailedLoginAt: null,
            lockedUntil: null,
            lastLoginAt: now,
          },
        });
        const { rawToken, session } = await createSession(tx, staffUser.id, auditContext);
        await writeAudit(tx, {
          actorStaffUserId: staffUser.id,
          action: 'auth.login_succeeded',
          entityType: 'StaffUser',
          entityId: staffUser.id,
          ...auditContext,
          afterSnapshot: { sessionId: session.id },
        });
        return { rawToken, session };
      }, STAFF_AUTH_TRANSACTION_OPTIONS);

      const refreshedStaff = await prisma.staffUser.findUnique({
        where: { id: staffUser.id },
        include: staffWithAccess(),
      });
      return {
        ...result,
        staff: publicStaff(refreshedStaff),
      };
    },

    async authenticateSession(rawToken) {
      if (!rawToken) {
        throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
      }
      const tokenHash = hashOpaqueToken(rawToken);
      const session = await prisma.staffSession.findUnique({
        where: { tokenHash },
        include: { staffUser: { include: staffWithAccess() } },
      });
      const now = new Date();
      const lastActivity = session?.lastUsedAt ?? session?.createdAt;
      const idleExpired =
        lastActivity &&
        now.getTime() - lastActivity.getTime() > config.SESSION_IDLE_TTL_SECONDS * 1000;
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= now ||
        idleExpired ||
        session.staffUser.status !== 'ACTIVE'
      ) {
        if (session && !session.revokedAt) {
          await prisma.staffSession.update({
            where: { id: session.id },
            data: { revokedAt: now },
          });
        }
        throw new AppError(401, 'SESSION_INVALID', 'Your session has expired. Sign in again.');
      }

      if (
        !session.lastUsedAt ||
        now.getTime() - session.lastUsedAt.getTime() >= SESSION_TOUCH_INTERVAL_MS
      ) {
        await prisma.staffSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { lastUsedAt: now },
        });
      }
      return {
        sessionId: session.id,
        staff: publicStaff(session.staffUser),
      };
    },

    async logout(rawToken, auditContext) {
      if (!rawToken) {
        return;
      }
      const session = await prisma.staffSession.findUnique({
        where: { tokenHash: hashOpaqueToken(rawToken) },
        select: { id: true, staffUserId: true, revokedAt: true },
      });
      if (!session || session.revokedAt) {
        return;
      }
      await prisma.$transaction(async (tx) => {
        await tx.staffSession.update({
          where: { id: session.id },
          data: { revokedAt: new Date() },
        });
        await writeAudit(tx, {
          actorStaffUserId: session.staffUserId,
          action: 'auth.logout',
          entityType: 'StaffSession',
          entityId: session.id,
          ...auditContext,
        });
      });
    },

    async logoutAll(staffUserId, auditContext) {
      await prisma.$transaction(async (tx) => {
        const now = new Date();
        const result = await tx.staffSession.updateMany({
          where: { staffUserId, revokedAt: null },
          data: { revokedAt: now },
        });
        await writeAudit(tx, {
          actorStaffUserId: staffUserId,
          action: 'auth.logout_all',
          entityType: 'StaffUser',
          entityId: staffUserId,
          ...auditContext,
          afterSnapshot: { revokedSessionCount: result.count },
        });
      });
    },

    async changePassword({ staffUserId, currentPassword, newPassword, auditContext }) {
      validatePassword(newPassword);
      const staffUser = await prisma.staffUser.findUnique({
        where: { id: staffUserId },
        select: { passwordHash: true, status: true },
      });
      if (
        !staffUser ||
        staffUser.status !== 'ACTIVE' ||
        !(await verifyPassword(staffUser.passwordHash, currentPassword))
      ) {
        throw new AppError(400, 'CURRENT_PASSWORD_INVALID', 'Current password is incorrect.');
      }
      const passwordHash = await hashPassword(newPassword);
      const result = await prisma.$transaction(async (tx) => {
        const now = new Date();
        await tx.$queryRaw`SELECT id FROM StaffUser WHERE id = ${staffUserId} FOR UPDATE`;
        const current = await tx.staffUser.findUnique({
          where: { id: staffUserId },
          select: { passwordHash: true, status: true },
        });
        if (!current || current.status !== 'ACTIVE' || current.passwordHash !== staffUser.passwordHash) {
          throw new AppError(400, 'CURRENT_PASSWORD_INVALID', 'Current password is incorrect.');
        }
        await tx.staffUser.update({
          where: { id: staffUserId },
          data: {
            passwordHash,
            passwordChangedAt: now,
            failedLoginCount: 0,
            lastFailedLoginAt: null,
            lockedUntil: null,
          },
        });
        await tx.staffSession.updateMany({
          where: { staffUserId, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.staffPasswordResetToken.updateMany({
          where: { staffUserId, usedAt: null, invalidatedAt: null },
          data: { invalidatedAt: now },
        });
        const { rawToken, session } = await createSession(tx, staffUserId, auditContext);
        await writeAudit(tx, {
          actorStaffUserId: staffUserId,
          action: 'auth.password_changed',
          entityType: 'StaffUser',
          entityId: staffUserId,
          ...auditContext,
          afterSnapshot: { sessionId: session.id },
        });
        return { rawToken, session };
      }, STAFF_AUTH_TRANSACTION_OPTIONS);
      return result;
    },

    async resetPassword({ token, newPassword, auditContext }) {
      validatePassword(newPassword);
      const tokenHash = hashOpaqueToken(token);
      const resetToken = await prisma.staffPasswordResetToken.findUnique({
        where: { tokenHash },
        include: {
          staffUser: { select: { status: true } },
        },
      });
      if (
        !resetToken ||
        resetToken.usedAt ||
        resetToken.invalidatedAt ||
        resetToken.expiresAt <= new Date() ||
        !(
          (resetToken.purpose === 'SETUP' && resetToken.staffUser.status === 'PENDING_SETUP') ||
          (resetToken.purpose === 'RESET' && resetToken.staffUser.status === 'ACTIVE')
        )
      ) {
        throw new AppError(400, 'RESET_TOKEN_INVALID', 'Password token is invalid or expired.');
      }

      const passwordHash = await hashPassword(newPassword);
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM StaffUser WHERE id = ${resetToken.staffUserId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM StaffPasswordResetToken WHERE id = ${resetToken.id} FOR UPDATE`;
        const current = await tx.staffPasswordResetToken.findUnique({
          where: { id: resetToken.id },
          include: { staffUser: { select: { status: true } } },
        });
        const now = new Date();
        if (
          !current ||
          current.usedAt ||
          current.invalidatedAt ||
          current.expiresAt <= now ||
          !(
            (current.purpose === 'SETUP' && current.staffUser.status === 'PENDING_SETUP') ||
            (current.purpose === 'RESET' && current.staffUser.status === 'ACTIVE')
          )
        ) {
          throw new AppError(400, 'RESET_TOKEN_INVALID', 'Password token is invalid or expired.');
        }
        await tx.staffUser.update({
          where: { id: current.staffUserId },
          data: {
            passwordHash,
            status: 'ACTIVE',
            passwordChangedAt: now,
            failedLoginCount: 0,
            lastFailedLoginAt: null,
            lockedUntil: null,
          },
        });
        await tx.staffPasswordResetToken.updateMany({
          where: {
            staffUserId: current.staffUserId,
            id: { not: current.id },
            usedAt: null,
            invalidatedAt: null,
          },
          data: { invalidatedAt: now },
        });
        await tx.staffPasswordResetToken.update({
          where: { id: current.id },
          data: { usedAt: now },
        });
        await tx.staffSession.updateMany({
          where: { staffUserId: current.staffUserId, revokedAt: null },
          data: { revokedAt: now },
        });
        await writeAudit(tx, {
          actorStaffUserId: current.staffUserId,
          action: current.purpose === 'SETUP'
            ? 'auth.password_setup_completed'
            : 'auth.password_reset_completed',
          entityType: 'StaffUser',
          entityId: current.staffUserId,
          ...auditContext,
        });
      }, STAFF_AUTH_TRANSACTION_OPTIONS);
      return { reset: true };
    },
  };
}
