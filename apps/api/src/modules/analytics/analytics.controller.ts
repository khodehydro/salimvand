import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { AnalyticsService } from './analytics.service';

/**
 * Public tracking endpoint: the storefront reports page visits here
 * (server-side `after()` calls, no cookies, no personal data — just the
 * path). Kept deliberately tiny and throttled by the global ThrottlerGuard.
 */
@Controller('public/analytics')
export class PublicAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post('track')
  async track(
    @Body()
    body?: {
      path?: string;
      kind?: string;
      term?: string;
      productId?: string;
    },
  ) {
    const kind = body?.kind === 'product' || body?.kind === 'search' ? body.kind : 'page';
    if (!body?.path) return { ok: true, data: { recorded: false } };
    await this.analytics.record({
      kind,
      path: body.path,
      term: body.term ?? null,
      productId: body.productId ?? null,
    });
    return { ok: true, data: { recorded: true } };
  }
}

/** Admin read side of the site analytics. */
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@Query('days') days?: string) {
    return this.analytics.overview(Number(days) || 30);
  }
}
