import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { InvoiceService } from './invoice.service';
import {
  CreateInvoiceCustomerDto,
  CreateInvoiceDto,
  PayInvoiceDto,
  ReturnInvoiceItemDto,
  UpdateInvoiceAddressesDto,
} from './invoice.dto';

type AuthenticatedRequest = Request & { user?: { id: string } };

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get('public/:token') getPublic(@Param('token') token: string) {
    return this.invoices.getPublic(token);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'accountant')
  @Get()
  list(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.invoices.list(cursor, limit);
  }

  // Static segments are declared before the `:id` param routes: NestJS matches
  // in declaration order, so GET /invoices/customers and /invoices/options
  // must never fall through to @Get(':id').
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Get('customers')
  customers(@Query('search') search?: string) {
    return this.invoices.customers(search);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Post('customers')
  createCustomer(@Body() body: CreateInvoiceCustomerDto) {
    return this.invoices.createCustomer(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Get('options')
  options() {
    return this.invoices.options();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'accountant')
  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() response: Response) {
    const file = await this.invoices.pdfById(id);
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${id}.pdf"`,
      'Content-Length': file.length,
    });
    return response.end(file);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'accountant')
  @Post(':id/link')
  link(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.invoices.rotateLink(id, request.user?.id ?? '', request.ip);
  }

  // Declared BEFORE @Get(':id') — Nest matches in declaration order. This is
  // the narrow read the mobile return sheet uses instead of the full invoice
  // detail: no customer PII and no payments, so warehouse can process returns.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('manager', 'warehouse', 'accountant')
  @Get(':id/return-context')
  returnContext(@Param('id') id: string) {
    return this.invoices.returnContext(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'accountant')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.invoices.get(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Post()
  create(@Body() body: CreateInvoiceDto, @Req() request: AuthenticatedRequest) {
    return this.invoices.create(body, request.user?.id ?? '');
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'accountant')
  @Post(':id/resend-sms')
  resendSms(
    @Param('id') id: string,
    @Body() body: { mobile?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.resendSms(id, request.user?.id ?? '', body?.mobile, request.ip);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'accountant')
  @Patch('checks/:checkId/status')
  @Roles('seller', 'accountant')
  updateCheckStatus(
    @Param('checkId') checkId: string,
    @Body() body: { status?: 'pending' | 'cleared' | 'bounced' | 'cancelled'; notes?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.updateCheckStatus(
      checkId,
      body.status ?? 'pending',
      body.notes,
      request.user?.id,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'accountant')
  @Post(':id/pay')
  pay(@Param('id') id: string, @Body() body: PayInvoiceDto, @Req() request: AuthenticatedRequest) {
    return this.invoices.pay(
      id,
      body.amount ?? 0,
      body.method ?? 'cash',
      request.user?.id ?? '',
      body.checks,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'accountant')
  @Patch(':id/addresses')
  updateAddresses(
    @Param('id') id: string,
    @Body() body: UpdateInvoiceAddressesDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.updateAddresses(id, body, request.user?.id ?? '', request.ip);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('manager')
  @Post(':id/void')
  void(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.invoices.void(id, request.user?.id ?? '');
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('manager', 'warehouse', 'accountant')
  @Post(':id/returns')
  returns(
    @Param('id') id: string,
    @Body() body: ReturnInvoiceItemDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invoices.returnItems(id, body, request.user?.id ?? '');
  }
}

@Controller('public/invoices')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class PublicInvoiceController {
  constructor(private readonly invoices: InvoiceService) {}
  @Get('qr/:shortCode') qr(@Param('shortCode') shortCode: string) {
    return this.invoices.qr(shortCode);
  }
  @Get('short/:shortCode/pdf') async pdfShort(
    @Param('shortCode') shortCode: string,
    @Res() response: Response,
  ) {
    const file = await this.invoices.pdf(shortCode);
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${shortCode}.pdf"`,
      'Content-Length': file.length,
    });
    return response.end(file);
  }
  @Get('short/:shortCode') getShort(@Param('shortCode') shortCode: string) {
    return this.invoices.getPublic(shortCode);
  }
  @Get(':token/pdf') async pdf(@Param('token') token: string, @Res() response: Response) {
    const file = await this.invoices.pdf(token);
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${token}.pdf"`,
      'Content-Length': file.length,
    });
    return response.end(file);
  }
  @Get(':token') get(@Param('token') token: string) {
    return this.invoices.getPublic(token);
  }
}
