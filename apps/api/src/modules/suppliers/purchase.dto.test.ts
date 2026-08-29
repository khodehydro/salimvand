import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePurchaseDto, SupplierPaymentDto } from './purchase.dto';

const uuid = '550e8400-e29b-41d4-a716-446655440000';
describe('Purchase DTO validation', () => {
  it('accepts a valid purchase', async () => {
    const dto = plainToInstance(CreatePurchaseDto, {
      supplierId: uuid,
      paidAmount: '1000',
      lines: [{ inventoryItemId: uuid, quantity: 2, unitPrice: '500' }],
    });
    expect(await validate(dto)).toHaveLength(0);
  });
  it('rejects empty or invalid payment data', async () => {
    expect(
      (await validate(plainToInstance(CreatePurchaseDto, { supplierId: 'bad', lines: [] }))).length,
    ).toBeGreaterThan(0);
    expect(
      (await validate(plainToInstance(SupplierPaymentDto, { amount: '-1', method: 'invalid' })))
        .length,
    ).toBeGreaterThan(0);
  });
});
