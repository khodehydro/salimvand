import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CustomerDto, CustomerPaymentDto } from './customers.dto';

describe('Customer DTO validation', () => {
  it('accepts a valid customer', async () => { expect(await validate(plainToInstance(CustomerDto, { name: 'علی', mobile: '09123456789' }))).toHaveLength(0); });
  it('rejects an invalid mobile and payment method', async () => { expect((await validate(plainToInstance(CustomerDto, { name: 'علی', mobile: '123' }))).length).toBeGreaterThan(0); expect((await validate(plainToInstance(CustomerPaymentDto, { amount: '100', method: 'crypto' }))).length).toBeGreaterThan(0); });
});
