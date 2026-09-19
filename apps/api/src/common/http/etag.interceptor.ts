import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { Observable, map } from 'rxjs';

/** Reference data (categories, brands, shelves, the vehicle tree) changes
 * rarely but is re-fetched constantly. Every response carries a strong ETag
 * of its exact JSON body plus `Cache-Control: no-cache`, so clients always
 * revalidate yet download nothing when nothing changed — a matching
 * If-None-Match is answered with 304 and zero body bytes. */
@Injectable()
export class EtagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    return next.handle().pipe(
      map((body) => {
        const payload = JSON.stringify(body ?? null, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        );
        const etag = `"${createHash('sha1').update(payload).digest('hex')}"`;
        response.setHeader('ETag', etag);
        // no-cache = "always revalidate WITH the server" — combined with the
        // ETag this is the zero-download pattern for near-static data.
        response.setHeader('Cache-Control', 'no-cache');
        const header = request.headers['if-none-match'];
        const matched =
          header === '*' ||
          (typeof header === 'string' && header.split(',').some((value) => value.trim() === etag));
        if (matched) {
          // Express suppresses the body on 304 — an empty payload keeps the
          // rest of the pipeline (serialization, interceptor order) intact.
          response.status(HttpStatus.NOT_MODIFIED);
          return '';
        }
        return body;
      }),
    );
  }
}
