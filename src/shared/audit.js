export async function writeAudit(tx, {
  actorStaffUserId = null,
  actorIdentifierSnapshot = null,
  action,
  entityType,
  entityId,
  requestId = null,
  ipAddress = null,
  userAgent = null,
  beforeSnapshot = undefined,
  afterSnapshot = undefined,
}) {
  return tx.auditLog.create({
    data: {
      actorStaffUserId,
      actorIdentifierSnapshot,
      action,
      entityType,
      entityId,
      requestId,
      ipAddress,
      userAgent,
      ...(beforeSnapshot === undefined ? {} : { beforeSnapshot }),
      ...(afterSnapshot === undefined ? {} : { afterSnapshot }),
    },
  });
}

export function requestAuditContext(req) {
  return {
    requestId: req.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
  };
}
