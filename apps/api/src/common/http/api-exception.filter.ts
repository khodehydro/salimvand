import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const details =
      typeof raw === 'object' && raw !== null
        ? (raw as { message?: string | string[]; code?: string })
        : {};
    const message = Array.isArray(details.message) ? details.message[0] : details.message;
    const code = details.code ?? this.codeFor(status);
    if (status >= 500) console.error({ path: request.url, method: request.method, exception });
    // For unexpected failures, surface a short diagnostic (e.g. the Prisma
    // error code) so operators can pinpoint the cause from the panel without
    // SSH access. Never includes stack traces or full SQL.
    const diagnostic =
      status >= 500 && typeof exception === 'object' && exception !== null
        ? String(
            (exception as { code?: unknown }).code ??
              (exception as { name?: unknown }).name ??
              'UNKNOWN',
          ).slice(0, 60)
        : undefined;
    response.status(status).json({
      ok: false,
      error: {
        code,
        message: message ?? 'خطای داخلی سرور',
        ...(diagnostic ? { detail: diagnostic } : {}),
      },
    });
  }
  private codeFor(status: number) {
    return (
      (
        {
          400: 'VALIDATION_ERROR',
          401: 'UNAUTHORIZED',
          403: 'FORBIDDEN',
          404: 'NOT_FOUND',
          409: 'CONFLICT',
          429: 'RATE_LIMITED',
        } as Record<number, string>
      )[status] ?? 'INTERNAL_ERROR'
    );
  }
}
