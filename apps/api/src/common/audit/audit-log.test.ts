import { describe, expect, it, vi } from 'vitest';
import { writeAudit, writeSyncChange, jsonSafe } from './audit-log';

type ChangeRow = {
  entityType: string;
  entityId: string;
  action: string;
  payload?: unknown;
  operationId?: string;
};

function makeTx() {
  const auditRows: unknown[] = [];
  const changeRows: ChangeRow[] = [];
  const tx = {
    auditLog: { create: vi.fn(async ({ data }: { data: unknown }) => auditRows.push(data)) },
    syncChange: { create: vi.fn(async ({ data }: { data: ChangeRow }) => changeRows.push(data)) },
  };
  return { tx, auditRows, changeRows };
}

describe('writeAudit sync publication', () => {
  it('stores a full payload for allowlisted entities and maps actions to created/updated/deleted', async () => {
    const { tx, changeRows } = makeTx();
    await writeAudit(tx as never, {
      userId: 'u1',
      action: 'create',
      entityType: 'product',
      entityId: 'p1',
      after: { name: 'لنت' },
      syncPayload: { id: 'p1', name: 'لنت', salePrice: '2450000' },
    });
    await writeAudit(tx as never, {
      userId: 'u1',
      action: 'pay',
      entityType: 'invoice',
      entityId: 'inv-1',
      after: { paidAmount: '100' },
      syncPayload: { id: 'inv-1', paidAmount: '100' },
    });
    await writeAudit(tx as never, {
      userId: 'u1',
      action: 'delete',
      entityType: 'customer',
      entityId: 'c1',
    });
    expect(changeRows.map((row) => [row.entityType, row.action])).toEqual([
      ['product', 'created'],
      ['invoice', 'updated'],
      ['customer', 'deleted'],
    ]);
    // create/update carry the snapshot; delete only needs the id.
    expect(changeRows[0].payload).toEqual({ id: 'p1', name: 'لنت', salePrice: '2450000' });
    expect(changeRows[2].payload).toEqual({ id: 'c1' });
  });

  it('keeps metadata-only invalidation for entity types offline clients do not cache', async () => {
    const { tx, changeRows } = makeTx();
    await writeAudit(tx as never, {
      userId: 'u1',
      action: 'update',
      entityType: 'supplier',
      entityId: 's1',
      after: { name: 'تأمین‌کننده' },
    });
    expect(changeRows).toEqual([{ entityType: 'supplier', entityId: 's1', action: 'update' }]);
  });

  it('never lets BigInt or Date reach the Prisma Json column', async () => {
    const { tx, changeRows } = makeTx();
    await writeAudit(tx as never, {
      action: 'create',
      entityType: 'inventory_item',
      entityId: 'i1',
      syncPayload: {
        id: 'i1',
        purchasePrice: 1850000n,
        createdAt: new Date('2026-09-17T00:00:00Z'),
        nested: { salePrice: 20n },
      },
    });
    expect(changeRows[0].payload).toEqual({
      id: 'i1',
      purchasePrice: '1850000',
      createdAt: '2026-09-17T00:00:00.000Z',
      nested: { salePrice: '20' },
    });
    expect(jsonSafe({ a: 1n })).toEqual({ a: '1' });
  });

  it('tolerates minimal transaction doubles without audit or sync delegates', async () => {
    await expect(
      writeAudit({} as never, { action: 'create', entityType: 'product', entityId: 'p1' }),
    ).resolves.toBeUndefined();
    await expect(
      writeSyncChange({} as never, { entityType: 'product', entityId: 'p1', action: 'created' }),
    ).resolves.toBeUndefined();
  });
});
