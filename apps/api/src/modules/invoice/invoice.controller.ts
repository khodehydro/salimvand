import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { InvoiceService } from './invoice.service';

type AuthenticatedRequest = Request & { user?: { id: string } };

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get('public/:token') getPublic(@Param('token') token: string) { return this.invoices.getPublic(token); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Get()
  list() { return this.invoices.list(); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Get('customers')
  customers(@Query('search') search?: string) { return this.invoices.customers(search); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Post('customers')
  createCustomer(@Body() body: { name?: string; mobile?: string; notes?: string }) { return this.invoices.createCustomer(body); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Get('options')
  options() { return this.invoices.options(); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Post()
  create(@Body() body: Parameters<InvoiceService['create']>[0], @Req() request: AuthenticatedRequest) { return this.invoices.create(body, request.user?.id ?? ''); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('accountant')
  @Post(':id/pay')
  pay(@Param('id') id: string, @Body() body: { amount?: string | number; method?: 'cash' | 'card' | 'transfer' | 'credit' }, @Req() request: AuthenticatedRequest) { return this.invoices.pay(id, body.amount ?? 0, body.method ?? 'cash', request.user?.id ?? ''); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('manager')
  @Post(':id/void')
  void(@Param('id') id: string, @Req() request: AuthenticatedRequest) { return this.invoices.void(id, request.user?.id ?? ''); }
}

@Controller('public/invoices')
export class PublicInvoiceController {
  constructor(private readonly invoices: InvoiceService) {}
  @Get(':token') get(@Param('token') token: string) { return this.invoices.getPublic(token); }
}
