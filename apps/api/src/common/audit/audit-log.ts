import { Prisma } from '@prisma/client';
import { isSyncPayloadEntity } from '../sync/sync-payloads';

export type AuditInput = {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  // Kept as unknown at the boundary so callers can safely pass snapshots containing BigInt.
  before?: unknown;
  after?: unknown;
  ip?: string;
  /** Full, secret-free snapshot for offline clients. Falls back to `after`
   * for the allowlisted entity types when the caller did not build one. */
  syncPayload?: unknown;
};

export type SyncChangeInput = {
  entityType: string;
  entityId: string;
  action: string;
  payload?: unknown;
  operationId?: string;
};

/** JSON-safe copy: BigInt → string, Date → ISO. Prisma Json columns cannot
 * hold either, and the sync payload contract is string-exact money anyway. */
export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>))
      result[key] = jsonSafe(entry);
    return result;
  }
  return value;
}

/** Offline clients only understand created/updated/deleted. Domain-specific
 * audit actions (issue, pay, void, adjust, receive, …) all mutate the entity,
 * so they are published as `updated` — with a full snapshot attached. */
const syncActionFor = (action: string): 'created' | 'updated' =>
  action === 'create' ? 'created' : 'updated';

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
  if (!isSyncPayloadEntity(input.entityType)) {
    // Publish metadata-only invalidation events for entity types offline
    // clients do not cache. Snapshots are deliberately excluded because they
    // may contain secrets.
    await writeSyncChange(tx, {
      entityType: input.entityType,
      entityId: input.entityId ?? 'unknown',
      action: input.action,
    });
    return;
  }
  const deleted = input.action === 'delete';
  // A deletion must never carry a stale upsert snapshot: the client only
  // needs the id to drop the row from its cache.
  const payload = deleted
    ? jsonSafe(input.syncPayload ?? { id: input.entityId })
    : jsonSafe(input.syncPayload ?? input.after ?? null);
  await writeSyncChange(tx, {
    entityType: input.entityType,
    entityId: input.entityId ?? 'unknown',
    action: deleted ? 'deleted' : syncActionFor(input.action),
    payload,
  });
}

/** Writes a SyncChange row directly (no audit-log entry) — for bulk mutations
 * that would flood the audit trail with hundreds of identical rows. */
export async function writeSyncChange(
  tx: Prisma.TransactionClient,
  input: SyncChangeInput,
): Promise<void> {
  const syncChange = (
    tx as unknown as { syncChange?: { create?: (args: unknown) => Promise<unknown> } }
  ).syncChange;
  if (!syncChange?.create) return;
  const payload =
    input.payload === undefined ? undefined : (jsonSafe(input.payload) as Prisma.InputJsonValue);
  await syncChange.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      ...(payload === null ? {} : { payload }),
      operationId: input.operationId,
    },
  });
}
