import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager', 'accountant')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get('sales') sales(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.sales(from, to);
  }
  @Get('inventory') inventory() {
    return this.reports.inventory();
  }
  @Get('inventory/export') async exportInventory(@Res() response: Response) {
    const csv = await this.reports.exportInventory();
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="salimvand-inventory.csv"');
    return response.send(`\uFEFF${csv}`);
  }
  @Get('profit') profit(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.profit(from, to);
  }
  @Get('customers') customers() {
    return this.reports.customers();
  }
  @Get('purchase-debts') purchaseDebts() {
    return this.reports.purchaseDebts();
  }
  @Get('purchase-debts/export') async exportPurchaseDebts(@Res() response: Response) {
    const csv = await this.reports.exportPurchaseDebts();
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="salimvand-supplier-debts.csv"',
    );
    return response.send(`\uFEFF${csv}`);
  }
  @Get('sales/export') async exportSales(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() response: Response,
  ) {
    const csv = await this.reports.exportSales(from, to);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="salimvand-sales.csv"');
    return response.send(`\uFEFF${csv}`);
  }
}
