import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
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
  @Post()
  create(@Body() body: Parameters<InvoiceService['create']>[0], @Req() request: AuthenticatedRequest) { return this.invoices.create(body, request.user?.id ?? ''); }
}
