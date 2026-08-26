import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get('sales') sales(@Query('from') from?: string, @Query('to') to?: string) { return this.reports.sales(from, to); }
  @Get('inventory') inventory() { return this.reports.inventory(); }
  @Get('profit') profit(@Query('from') from?: string, @Query('to') to?: string) { return this.reports.profit(from, to); }
}
