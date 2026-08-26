import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
type AuthenticatedRequest = Request & { user?: { id: string } };
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { InventoryService } from './inventory.service';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('warehouse')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Get('items') list() { return this.inventory.list(); }
  @Post('items') create(@Body() body: { productId?: string; brandId?: string; barcode?: string; purchasePrice?: number; salePrice?: number; minStock?: number; locationId?: string; initialQuantity?: number }, @Req() request: AuthenticatedRequest) { return this.inventory.create({ ...body, userId: request.user?.id }); }
  @Post('items/:id/adjust') adjust(@Param('id') itemId: string, @Body() body: { quantity?: number; reason?: string }, @Req() request: AuthenticatedRequest) { return this.inventory.adjust({ itemId, quantity: Number(body.quantity), userId: request.user?.id ?? '', reason: body.reason }); }
  @Post('receive') receive(@Body() body: { itemId?: string; quantity?: number; reason?: string }, @Req() request: AuthenticatedRequest) { return this.inventory.receive({ itemId: body.itemId ?? '', quantity: Number(body.quantity), userId: request.user?.id ?? '', reason: body.reason }); }
  @Post('transfer') transfer(@Body() body: { itemId?: string; locationId?: string }, @Req() request: AuthenticatedRequest) { return this.inventory.transfer(body.itemId ?? '', body.locationId ?? '', request.user?.id ?? ''); }
  @Get('low-stock') lowStock() { return this.inventory.lowStock(); }
  @Get('barcode/:code') barcode(@Param('code') code: string) { return this.inventory.byBarcode(code); }
  @Get('items/:id/transactions') transactions(@Param('id') itemId: string) { return this.inventory.transactions(itemId); }
}
