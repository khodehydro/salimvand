import { describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter', () => {
  function response() {
    return {
      statusCode: 0,
      payload: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.payload = payload;
        return payload;
      },
    };
  }
  it('returns the standard validation envelope', () => {
    const res = response();
    new ApiExceptionFilter().catch(new BadRequestException(['نام الزامی است']), {
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => ({ url: '/x', method: 'POST' }),
      }),
    } as never);
    expect(res.statusCode).toBe(400);
    expect(res.payload).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'نام الزامی است' },
    });
  });
  it('maps not found exceptions', () => {
    const res = response();
    new ApiExceptionFilter().catch(new NotFoundException('یافت نشد'), {
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => ({ url: '/x', method: 'GET' }),
      }),
    } as never);
    expect(res.payload).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'یافت نشد' } });
  });
});
