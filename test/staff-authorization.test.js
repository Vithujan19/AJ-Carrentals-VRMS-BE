import { describe, expect, it, vi } from 'vitest';
import { createRolesService } from '../src/modules/roles/roles.service.js';
import { createStaffService } from '../src/modules/staff/staff.service.js';
import { roleTemplates } from '../src/shared/permissions.js';

describe('privileged staff administration', () => {
  it('includes the administrator marker in the seeded ADMIN template', () => {
    expect(roleTemplates.ADMIN.has('staff.manage')).toBe(true);
    expect(roleTemplates.ADMIN.has('roles.manage')).toBe(true);
    expect(roleTemplates.ADMIN.has('staff.roles.assign_privileged')).toBe(true);
  });

  it('prevents a lower-privilege staff member from changing an administrator profile', async () => {
    const prisma = {
      staffUser: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'admin-id',
          roleAssignments: [{
            role: {
              permissionLinks: [{ permission: { code: 'staff.manage' } }],
            },
          }],
        }),
      },
      $transaction: vi.fn(),
    };
    const service = createStaffService({ prisma, authService: {} });

    await expect(service.updateProfile({
      id: 'admin-id',
      input: { email: 'changed@example.lk' },
      actor: { id: 'manager-id', email: 'manager@example.lk', permissions: ['staff.update'] },
      auditContext: {},
    })).rejects.toMatchObject({ status: 403, code: 'PRIVILEGED_STAFF_MANAGEMENT_DENIED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('prevents a delegated role manager from editing a more privileged role', async () => {
    const tx = {
      role: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'admin-role',
          code: 'ADMIN',
          permissionLinks: [
            { permission: { code: 'roles.manage' } },
            { permission: { code: 'staff.manage' } },
          ],
        }),
      },
      rolePermission: { deleteMany: vi.fn() },
    };
    const prisma = {
      permission: {
        findMany: vi.fn().mockResolvedValue([{ id: 'roles-manage', code: 'roles.manage' }]),
      },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = createRolesService({ prisma });

    await expect(service.updatePermissions({
      roleId: 'admin-role',
      permissionCodes: ['roles.manage'],
      actor: { id: 'manager-id', email: 'manager@example.lk', permissions: ['roles.manage'] },
      auditContext: {},
    })).rejects.toMatchObject({ status: 403, code: 'PRIVILEGED_ROLE_MANAGEMENT_DENIED' });
    expect(tx.rolePermission.deleteMany).not.toHaveBeenCalled();
  });
});
