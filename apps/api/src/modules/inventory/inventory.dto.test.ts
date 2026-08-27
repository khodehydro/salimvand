import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdjustInventoryDto, CreateInventoryItemDto, ReceiveInventoryDto } from './inventory.dto';

const uuid = '550e8400-e29b-41d4-a716-446655440000';

describe('Inventory DTO validation', () => {
  it('accepts a valid stock item and transforms numeric values', async () => {
    const dto = plainToInstance(CreateInventoryItemDto, { productId: uuid, brandId: uuid, purchasePrice: '100000', salePrice: '150000', initialQuantity: '4' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.salePrice).toBe(150000);
    expect(dto.initialQuantity).toBe(4);
  });
  it('rejects invalid identifiers and negative stock values', async () => {
    const dto = plainToInstance(CreateInventoryItemDto, { productId: 'not-uuid', brandId: uuid, initialQuantity: -1, salePrice: -10 });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
  it('requires a reason for adjustment and a positive receipt quantity', async () => {
    const adjustment = plainToInstance(AdjustInventoryDto, { quantity: 3 });
    const receipt = plainToInstance(ReceiveInventoryDto, { itemId: uuid, quantity: 0 });
    expect((await validate(adjustment)).length).toBeGreaterThan(0);
    expect((await validate(receipt)).length).toBeGreaterThan(0);
  });
});
