import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { ReportsService } from './reports.service';

const csvCell = (value: unknown) => {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  return /^[=+\-@]/.test(text) ? `'${text}` : `"${text.replaceAll('"', '""')}"`;
};
const csv = (headers: string[], rows: Array<Array<unknown>>) => [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\n');

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager', 'accountant')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get('sales') sales(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.sales(from, to);
  }
  @Get('supplier-checks') supplierChecks(@Query('status') status?: string) {
    return this.reports.supplierChecks(status);
  }
  @Get('returns') returns(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.returns(from, to);
  }
  @Get('returns/export') async exportReturns(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @Res() response: Response) {
    const result = await this.reports.returns(from, to);
    const body = csv(['فاکتور', 'مشتری', 'محصول', 'تعداد', 'مبلغ برگشت', 'مقصد', 'دلیل'], result.data.rows.map((row) => [row.invoice.number, row.invoice.customerName ?? 'حضوری', row.product, row.quantity, row.refundAmount, row.restock ? 'بازگشت به انبار' : 'ضایعات', row.reason]));
    response.setHeader('Content-Type', 'text/csv; charset=utf-8'); response.setHeader('Content-Disposition', 'attachment; filename="salimvand-returns.csv"'); return response.send(`\uFEFF${body}`);
  }
  @Get('checks/export') async exportChecks(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @Query('status') status: string | undefined, @Res() response: Response) {
    const result = await this.reports.checks(from, to, status);
    const body = csv(['فاکتور', 'مشتری', 'بانک', 'شماره چک', 'سررسید', 'مبلغ', 'وضعیت'], result.data.map((row) => [row.invoice.number, row.invoice.customerName ?? 'حضوری', row.bank, row.checkNumber, row.dueDate, row.amount, row.status]));
    response.setHeader('Content-Type', 'text/csv; charset=utf-8'); response.setHeader('Content-Disposition', 'attachment; filename="salimvand-checks.csv"'); return response.send(`\uFEFF${body}`);
  }
  @Get('supplier-checks/export') async exportSupplierChecks(@Query('status') status: string | undefined, @Res() response: Response) {
    const result = await this.reports.supplierChecks(status);
    const body = csv(['فاکتور خرید', 'تأمین‌کننده', 'بانک', 'شماره چک', 'سررسید', 'مبلغ', 'وضعیت'], result.data.map((row) => [row.invoice.number, row.invoice.supplierName, row.bank, row.checkNumber, row.dueDate, row.amount, row.status]));
    response.setHeader('Content-Type', 'text/csv; charset=utf-8'); response.setHeader('Content-Disposition', 'attachment; filename="salimvand-supplier-checks.csv"'); return response.send(`\uFEFF${body}`);
  }
  @Get('checks') checks(@Query('from') from?: string, @Query('to') to?: string, @Query('status') status?: string, @Query('bank') bank?: string) {
    return this.reports.checks(from, to, status, bank);
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
  @Get('inventory/accounting-export') async exportInventoryAccounting(@Res() response: Response) {
    const workbook = await this.reports.exportInventoryAccounting();
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="salimvand-products-accounting.xlsx"');
    return response.send(workbook);
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
