import { describe, expect, it, vi } from 'vitest';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

describe('AuditService', () => {
  it('returns paginated audit logs with count', async () => {
    const prisma = {
      auditLog: {
        count: vi.fn(async () => 1),
        findMany: vi.fn(async () => [
          { id: 1n, userId: 'user-1', action: 'create', entityType: 'customer', createdAt: new Date() },
        ]),
      },
    };
    const service = new AuditService(prisma as never);
    const result = await service.list({ action: 'create' });
    expect(result.ok).toBe(true);
    expect(result.data.total).toBe(1);
    expect(result.data.rows).toHaveLength(1);
  });
});

describe('AuditController', () => {
  it('delegates query parameters to service', async () => {
    const list = vi.fn(async () => ({ ok: true, data: { total: 0, rows: [] } }));
    const controller = new AuditController({ list } as never);
    await controller.list('user-1', 'create', 'customer', undefined, undefined, '10', '0');
    expect(list).toHaveBeenCalledWith({
      userId: 'user-1',
      action: 'create',
      entityType: 'customer',
      from: undefined,
      to: undefined,
      take: 10,
      skip: 0,
    });
  });
});
