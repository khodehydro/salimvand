import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateInvoiceDto, PayInvoiceDto } from './invoice.dto';

describe('Invoice DTO validation', () => {
  it('accepts a valid invoice payload', async () => {
    const dto = plainToInstance(CreateInvoiceDto, { customerName: 'علی', customerMobile: '09123456789', discount: 100, items: [{ inventoryItemId: 'item-1', quantity: 2, unitPrice: '18500000' }] });
    expect(await validate(dto)).toHaveLength(0);
  });
  it('rejects unsafe quantities, prices and mobile numbers', async () => {
    const dto = plainToInstance(CreateInvoiceDto, { customerMobile: '123', items: [{ inventoryItemId: 'item-1', quantity: 0, unitPrice: '-1' }] });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
  it('requires a numeric payment amount and supported method', async () => {
    const dto = plainToInstance(PayInvoiceDto, { amount: 'abc', method: 'bitcoin' });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
