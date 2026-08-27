import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get('summary') summary() { return this.dashboard.summary(); }
  @Get('sales-trend') salesTrend(@Query('from') from?: string, @Query('to') to?: string) { return this.dashboard.salesTrend(from, to); }
  @Get('audit') audit(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('entityType') entityType?: string) { return this.dashboard.audit(Number(page ?? 1), Number(pageSize ?? 50), entityType); }
}
