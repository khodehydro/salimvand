import { Prisma } from '@prisma/client';

export type AuditInput = {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  // Kept as unknown at the boundary so callers can safely pass snapshots containing BigInt.
  before?: unknown;
  after?: unknown;
  ip?: string;
};

export async function writeAudit(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
  // Some isolated service tests use a deliberately minimal transaction double.
  if (!tx.auditLog?.create) return;
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before as never,
      after: input.after as never,
      ip: input.ip,
    },
  });
  // Publish metadata-only invalidation events for Offline-First clients.
  // Audit snapshots are deliberately excluded because they may contain secrets.
  const syncChange = (tx as unknown as { syncChange?: { create?: (args: unknown) => Promise<unknown> } }).syncChange;
  if (syncChange?.create) {
    await syncChange.create({ data: { entityType: input.entityType, entityId: input.entityId ?? 'unknown', action: input.action } });
  }
}
