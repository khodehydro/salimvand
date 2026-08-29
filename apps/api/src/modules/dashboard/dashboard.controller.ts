import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller', 'warehouse', 'accountant')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get('summary') summary() {
    return this.dashboard.summary();
  }
  @Roles('accountant')
  @Get('profit-trend')
  profitTrend(@Query('from') from?: string, @Query('to') to?: string) {
    return this.dashboard.profitTrend(from, to);
  }
  @Roles('warehouse')
  @Get('inventory-trend')
  inventoryTrend(@Query('from') from?: string, @Query('to') to?: string) {
    return this.dashboard.inventoryTrend(from, to);
  }
  @Roles('seller', 'accountant')
  @Get('sales-trend')
  salesTrend(@Query('from') from?: string, @Query('to') to?: string) {
    return this.dashboard.salesTrend(from, to);
  }
  @Roles('manager')
  @Get('audit')
  audit(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.dashboard.audit(Number(page ?? 1), Number(pageSize ?? 50), entityType);
  }
}
