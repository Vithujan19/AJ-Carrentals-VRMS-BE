import { describe, expect, it, vi } from 'vitest';
import { requirePermission } from '../src/middleware/authorize.js';

describe('permission authorization', () => {
  it('allows the request only when the authenticated staff member has the required permission', () => {
    const next = vi.fn();
    const req = { auth: { staff: { permissions: ['bookings.view', 'payments.view'] } } };

    requirePermission('payments.view')(req, {}, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a user without the required permission', () => {
    const next = vi.fn();
    const req = { auth: { staff: { permissions: ['bookings.view'] } } };

    expect(() => requirePermission('payments.view')(req, {}, next)).toThrow(
      expect.objectContaining({ status: 403, code: 'PERMISSION_DENIED' }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
