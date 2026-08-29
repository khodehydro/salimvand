import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { PurchaseService } from './purchase.service';
import { CreatePurchaseDto, SupplierPaymentDto } from './purchase.dto';

type AuthRequest = Request & { user?: { id: string } };
@Controller('purchases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'manager', 'accountant')
export class PurchaseController {
  constructor(private readonly purchases: PurchaseService) {}
  @Get() list(@Query('supplierId') supplierId?: string) {
    return this.purchases.list(supplierId);
  }
  @Get(':id') get(@Param('id') id: string) {
    return this.purchases.get(id);
  }
  @Post() @Roles('manager') create(@Body() body: CreatePurchaseDto, @Req() request: AuthRequest) {
    return this.purchases.create(
      body.supplierId ?? '',
      body.lines ?? [],
      body.paidAmount,
      request.user?.id ?? '',
      request.ip,
    );
  }
  @Post(':id/payments') pay(
    @Param('id') id: string,
    @Body() body: SupplierPaymentDto,
    @Req() request: AuthRequest,
  ) {
    return this.purchases.pay(
      id,
      body.amount ?? 0,
      body.method ?? 'transfer',
      body.notes,
      request.user?.id ?? '',
      request.ip,
    );
  }
}
