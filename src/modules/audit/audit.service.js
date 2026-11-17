export function createAuditService({ prisma }) {
  return {
    async list({ page, limit, actorStaffUserId, action, entityType, from, to }) {
      const occurredAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lt: to } : {}),
      };
      const where = {
        ...(actorStaffUserId ? { actorStaffUserId } : {}),
        ...(action ? { action: { contains: action } } : {}),
        ...(entityType ? { entityType } : {}),
        ...(Object.keys(occurredAt).length ? { occurredAt } : {}),
      };
      const [items, total] = await prisma.$transaction([
        prisma.auditLog.findMany({
          where,
          select: {
            id: true,
            actorStaffUserId: true,
            actorIdentifierSnapshot: true,
            action: true,
            entityType: true,
            entityId: true,
            occurredAt: true,
            requestId: true,
            ipAddress: true,
            userAgent: true,
            beforeSnapshot: true,
            afterSnapshot: true,
          },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.auditLog.count({ where }),
      ]);
      return {
        items,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    },
  };
}
