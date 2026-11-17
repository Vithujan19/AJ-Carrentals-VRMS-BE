import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createAuthRouter } from '../src/modules/auth/auth.routes.js';
import { createStaffRouter } from '../src/modules/staff/staff.routes.js';
import { createStaffService } from '../src/modules/staff/staff.service.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { AppError } from '../src/shared/errors.js';
import { hashOpaqueToken, hashPassword, verifyPassword } from '../src/shared/passwords.js';

const staffId = '00000000-0000-4000-8000-000000000001';
const actor = { id: 'admin', email: 'admin@example.test', permissions: ['staff.manage'] };

function createDatabase(initialStatus = 'PENDING_SETUP', { slowTransactions = false } = {}) {
  const staff = {
    id: staffId,
    status: initialStatus,
    passwordHash: initialStatus === 'ACTIVE' ? 'old-hash' : null,
    roleAssignments: [],
    emailNormalized: 'staff@example.test',
    displayName: 'Staff',
    mobileNumber: null,
  };
  const tokens = [];
  const sessions = [{ staffUserId: staffId, revokedAt: null }];
  const audits = [];
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: staffId }]),
    staffUser: {
      findUnique: vi.fn(async () => staff),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(async ({ data }) => Object.assign(staff, data)),
    },
    vehicleStaffAssignment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    staffPasswordResetToken: {
      findUnique: vi.fn(async ({ where }) => {
        const found = tokens.find((entry) => (
          where.id ? entry.id === where.id : entry.tokenHash === where.tokenHash
        ));
        return found ? { ...found, staffUser: { status: staff.status } } : null;
      }),
      create: vi.fn(async ({ data }) => {
        const entry = {
          ...data,
          id: `token-${tokens.length}`,
          usedAt: null,
          invalidatedAt: null,
        };
        tokens.push(entry);
        return entry;
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const selected = tokens.filter((entry) => (
          entry.staffUserId === where.staffUserId &&
          (!where.purpose || entry.purpose === where.purpose) &&
          (!where.id?.not || entry.id !== where.id.not) &&
          entry.usedAt === null && entry.invalidatedAt === null
        ));
        selected.forEach((entry) => Object.assign(entry, data));
        return { count: selected.length };
      }),
      update: vi.fn(async ({ where, data }) => Object.assign(
        tokens.find((entry) => entry.id === where.id),
        data,
      )),
    },
    staffSession: {
      updateMany: vi.fn(async ({ where, data }) => {
        const selected = sessions.filter((session) => (
          session.staffUserId === where.staffUserId && session.revokedAt === null
        ));
        selected.forEach((session) => Object.assign(session, data));
        return { count: selected.length };
      }),
    },
    auditLog: { create: vi.fn(async ({ data }) => audits.push(data)) },
  };
  db.$transaction = vi.fn(async (operation, options) => {
    if (slowTransactions && (options?.timeout ?? 5000) < 6000) {
      throw new Error('Simulated remote transaction timeout');
    }
    return operation(db);
  });
  return { db, staff, tokens, sessions, audits };
}

describe('administrator password tokens', () => {
  it('creates a pending account without an email delivery service or usable password', async () => {
    const { db } = createDatabase('PENDING_SETUP', { slowTransactions: true });
    const role = { id: 'role-1', permissionLinks: [] };
    db.role = { findMany: vi.fn().mockResolvedValue([role]) };
    db.staffUser.create = vi.fn(async ({ data }) => ({
      ...data,
      id: staffId,
      roleAssignments: [{ role: { ...role, code: 'MAINTAINER', name: 'Maintainer' } }],
    }));
    const service = createStaffService({ prisma: db, config: {} });

    const result = await service.create({
      input: { email: 'staff@example.test', displayName: 'Staff', roleIds: [role.id] },
      actor,
      auditContext: {},
    });

    expect(result.staff.status).toBe('PENDING_SETUP');
    expect(db.staffUser.create.mock.calls[0][0].data.passwordHash).toBeNull();
  });

  it('stores only hashes, invalidates the previous token, and supports revocation', async () => {
    const { db, tokens, audits } = createDatabase('PENDING_SETUP', { slowTransactions: true });
    const service = createStaffService({ prisma: db, config: { PASSWORD_RESET_TTL_SECONDS: 1800 } });
    const first = await service.generatePasswordToken({ id: staffId, actor, auditContext: {} });
    const second = await service.generatePasswordToken({ id: staffId, actor, auditContext: {} });

    expect(first.purpose).toBe('SETUP');
    expect(tokens[0].tokenHash).toBe(hashOpaqueToken(first.token));
    expect(tokens[0].invalidatedAt).toBeInstanceOf(Date);
    expect(tokens[1].tokenHash).toBe(hashOpaqueToken(second.token));
    expect(JSON.stringify(audits)).not.toContain(first.token);
    expect(JSON.stringify(audits)).not.toContain(second.token);

    await service.revokePasswordTokens({ id: staffId, actor, auditContext: {} });
    expect(tokens[1].invalidatedAt).toBeInstanceOf(Date);
  });

  it('activates a pending account once and invalidates existing sessions', async () => {
    const { db, staff, tokens, sessions } = createDatabase('PENDING_SETUP', { slowTransactions: true });
    const config = { PASSWORD_RESET_TTL_SECONDS: 1800 };
    const staffService = createStaffService({ prisma: db, config });
    const auth = createAuthService({ prisma: db, config });
    const { token } = await staffService.generatePasswordToken({ id: staffId, actor, auditContext: {} });

    await auth.resetPassword({ token, newPassword: 'new-password-123', auditContext: {} });
    expect(staff.status).toBe('ACTIVE');
    expect(await verifyPassword(staff.passwordHash, 'new-password-123')).toBe(true);
    expect(tokens[0].usedAt).toBeInstanceOf(Date);
    expect(sessions[0].revokedAt).toBeInstanceOf(Date);
    await expect(auth.resetPassword({ token, newPassword: 'new-password-123', auditContext: {} }))
      .rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID' });
  });

  it('resets active accounts and rejects expired, revoked and legacy email tokens', async () => {
    const { db, tokens, sessions } = createDatabase('ACTIVE');
    const config = { PASSWORD_RESET_TTL_SECONDS: 1800 };
    const staffService = createStaffService({ prisma: db, config });
    const auth = createAuthService({ prisma: db, config });
    const input = { id: staffId, actor, auditContext: {} };

    const expired = await staffService.generatePasswordToken(input);
    tokens[0].expiresAt = new Date(0);
    await expect(auth.resetPassword({ token: expired.token, newPassword: 'new-password-123', auditContext: {} }))
      .rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID' });

    const revoked = await staffService.generatePasswordToken(input);
    await staffService.revokePasswordTokens(input);
    await expect(auth.resetPassword({ token: revoked.token, newPassword: 'new-password-123', auditContext: {} }))
      .rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID' });

    const legacy = await staffService.generatePasswordToken(input);
    tokens[2].purpose = 'LEGACY_EMAIL';
    await expect(auth.resetPassword({ token: legacy.token, newPassword: 'new-password-123', auditContext: {} }))
      .rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID' });

    const valid = await staffService.generatePasswordToken(input);
    expect(valid.purpose).toBe('RESET');
    await auth.resetPassword({ token: valid.token, newPassword: 'new-password-123', auditContext: {} });
    expect(sessions[0].revokedAt).toBeInstanceOf(Date);
  });

  it('returns a reactivated passwordless account to pending setup, not active', async () => {
    const { db, staff } = createDatabase();
    const service = createStaffService({ prisma: db, config: {} });
    await service.updateStatus({ id: staffId, status: 'INACTIVE', actor, auditContext: {} });
    expect(staff.status).toBe('INACTIVE');
    await service.updateStatus({ id: staffId, status: 'ACTIVE', actor, auditContext: {} });
    expect(staff.status).toBe('PENDING_SETUP');
    expect(staff.passwordHash).toBeNull();
  });

  it('rejects a token revoked after its initial lookup', async () => {
    const { db, tokens } = createDatabase();
    const config = { PASSWORD_RESET_TTL_SECONDS: 1800 };
    const staffService = createStaffService({ prisma: db, config });
    const auth = createAuthService({ prisma: db, config });
    const { token } = await staffService.generatePasswordToken({ id: staffId, actor, auditContext: {} });
    db.$queryRaw.mockImplementationOnce(async () => {
      tokens[0].invalidatedAt = new Date();
      return [{ id: staffId }];
    });
    await expect(auth.resetPassword({ token, newPassword: 'new-password-123', auditContext: {} }))
      .rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID' });
    expect(db.staffUser.update).not.toHaveBeenCalled();
  });

  it('does not create a session when a password changes after verification', async () => {
    const { db, staff } = createDatabase('ACTIVE', { slowTransactions: true });
    staff.passwordHash = await hashPassword('old-password-123');
    db.staffUser.findUnique.mockResolvedValueOnce({ ...staff });
    db.$queryRaw.mockImplementationOnce(async () => {
      staff.passwordHash = 'changed-after-verification';
      return [{ id: staffId }];
    });
    const auth = createAuthService({ prisma: db, config: {} });
    await expect(auth.login({
      email: staff.emailNormalized, password: 'old-password-123', auditContext: {},
    })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(db.staffUser.update).not.toHaveBeenCalled();
  });

  it('changes a password using the remote transaction budget', async () => {
    const { db, staff, sessions } = createDatabase('ACTIVE', { slowTransactions: true });
    staff.passwordHash = await hashPassword('old-password-123');
    db.staffSession.create = vi.fn(async ({ data }) => ({ ...data, id: 'new-session' }));
    const auth = createAuthService({ prisma: db, config: { SESSION_TTL_SECONDS: 1800 } });

    await auth.changePassword({
      staffUserId: staffId,
      currentPassword: 'old-password-123',
      newPassword: 'new-password-123',
      auditContext: {},
    });
    expect(await verifyPassword(staff.passwordHash, 'new-password-123')).toBe(true);
    expect(sessions[0].revokedAt).toBeInstanceOf(Date);
  });

  it('enforces the token permission and prevents response caching', async () => {
    let permissions = [];
    const service = { generatePasswordToken: vi.fn().mockResolvedValue({ token: 'test-token' }) };
    const app = express();
    app.use('/staff', createStaffRouter({
      staffService: service,
      authenticate: (req, _res, next) => {
        req.auth = { staff: { ...actor, permissions } };
        next();
      },
    }));
    app.use(errorHandler({ error: vi.fn() }));

    await request(app).post(`/staff/${staffId}/password-token`).expect(403);
    expect(service.generatePasswordToken).not.toHaveBeenCalled();
    await request(app).delete(`/staff/${staffId}/password-token`).expect(403);
    permissions = ['staff.manage'];
    const response = await request(app).post(`/staff/${staffId}/password-token`).expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.token).toBe('test-token');
  });

  it('rate limits password-token validation attempts', async () => {
    const authService = {
      resetPassword: vi.fn().mockRejectedValue(new AppError(400, 'RESET_TOKEN_INVALID', 'Invalid token.')),
    };
    const app = express();
    app.use(express.json());
    app.use('/auth', createAuthRouter({ authService, authenticate: (_req, _res, next) => next(), config: {} }));
    app.use(errorHandler({ error: vi.fn() }));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post('/auth/reset-password').send({
        token: 'x'.repeat(43), newPassword: 'new-password-123',
      }).expect(400);
    }
    await request(app).post('/auth/reset-password').send({
      token: 'x'.repeat(43), newPassword: 'new-password-123',
    }).expect(429);
    expect(authService.resetPassword).toHaveBeenCalledTimes(5);
  });

  it('does not log token-bearing malformed JSON bodies', () => {
    const logger = { error: vi.fn() };
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const error = Object.assign(new SyntaxError('invalid JSON'), {
      type: 'entity.parse.failed',
      body: '{"token":"sensitive-token"',
    });
    errorHandler(logger)(error, { id: 'request-1' }, response, vi.fn());
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sensitive-token');
    expect(response.status).toHaveBeenCalledWith(400);
  });
});
