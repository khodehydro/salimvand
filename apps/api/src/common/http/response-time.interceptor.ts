import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

/** Measures server-side handling time on every request and reports it:
 *  - as an `X-Response-Time` response header, so a client (curl -w, an
 *    OkHttp logging interceptor) can separate network latency from server
 *    processing without SSH access,
 *  - as a one-line console.warn for anything slower than SLOW_MS naming the
 *    route — the log pinpoints WHICH endpoint is slow before any deeper
 *    profiling is attempted. */
@Injectable()
export class ResponseTimeInterceptor implements NestInterceptor {
  private static readonly SLOW_MS = 300;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = process.hrtime.bigint();
    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    // tap's error path runs BEFORE the exception filter sends its response,
    // so the header is present on error envelopes too.
    return next.handle().pipe(
      tap({
        next: () => this.report(response, request, start),
        error: () => this.report(response, request, start),
      }),
    );
  }

  private report(response: Response, request: Request, start: bigint) {
    if (typeof response.setHeader !== 'function' || response.headersSent) return;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    response.setHeader('X-Response-Time', `${ms.toFixed(1)}ms`);
    if (ms >= ResponseTimeInterceptor.SLOW_MS)
      console.warn(`[slow] ${request.method} ${request.originalUrl} took ${ms.toFixed(1)}ms`);
  }
}
