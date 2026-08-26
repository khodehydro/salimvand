import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { PurchaseService } from './purchase.service';

type AuthRequest = Request & { user?: { id: string } };
@Controller('purchases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'manager', 'accountant')
export class PurchaseController {
  constructor(private readonly purchases: PurchaseService) {}
  @Get() list(@Query('supplierId') supplierId?: string) { return this.purchases.list(supplierId); }
  @Post() create(@Body() body: { supplierId?: string; paidAmount?: number | string; lines?: Array<{ inventoryItemId?: string; quantity?: number; unitPrice?: number | string }> }, @Req() request: AuthRequest) { return this.purchases.create(body.supplierId ?? '', body.lines ?? [], body.paidAmount, request.user?.id ?? '', request.ip); }
}
