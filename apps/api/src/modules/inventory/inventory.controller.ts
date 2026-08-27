import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
type AuthenticatedRequest = Request & { user?: { id: string } };
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { InventoryService } from './inventory.service';
import { AdjustInventoryDto, CreateInventoryItemDto, ReceiveInventoryDto, TransferInventoryDto, UpdateInventoryItemDto } from './inventory.dto';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('warehouse')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Get('items') list(@Query('q') q?: string, @Query('brandId') brandId?: string, @Query('locationId') locationId?: string, @Query('status') status?: 'low' | 'out') { return this.inventory.list({ q, brandId, locationId, status }); }
  @Post('items') create(@Body() body: CreateInventoryItemDto, @Req() request: AuthenticatedRequest) { return this.inventory.create({ ...body, userId: request.user?.id }); }
  @Patch('items/:id') updateItem(@Param('id') id: string, @Body() body: UpdateInventoryItemDto, @Req() request: AuthenticatedRequest) { return this.inventory.updateItem(id, body, request.user?.id); }
  @Post('items/:id/adjust') adjust(@Param('id') itemId: string, @Body() body: AdjustInventoryDto, @Req() request: AuthenticatedRequest) { return this.inventory.adjust({ itemId, quantity: Number(body.quantity), userId: request.user?.id ?? '', reason: body.reason }); }
  @Post('receive') receive(@Body() body: ReceiveInventoryDto, @Req() request: AuthenticatedRequest) { return this.inventory.receive({ itemId: body.itemId ?? '', quantity: Number(body.quantity), userId: request.user?.id ?? '', reason: body.reason }); }
  @Post('transfer') transfer(@Body() body: TransferInventoryDto, @Req() request: AuthenticatedRequest) { return this.inventory.transfer(body.itemId ?? '', body.locationId ?? '', request.user?.id ?? ''); }
  @Get('low-stock') lowStock() { return this.inventory.lowStock(); }
  @Get('reconciliation') @Roles('manager', 'warehouse') reconciliation() { return this.inventory.reconciliation(); }
  @Get('barcode/:code') barcode(@Param('code') code: string) { return this.inventory.byBarcode(code); }
  @Get('items/:id/transactions') transactions(@Param('id') itemId: string) { return this.inventory.transactions(itemId); }
}
