import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CustomersService } from './customers.service';

type AuthRequest = Request & { user?: { id: string } };
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}
  @Get() list(@Query('search') search?: string) { return this.customers.list(search); }
  @Get('debtors') debtors() { return this.customers.debtors(); }
  @Get(':id') get(@Param('id') id: string) { return this.customers.get(id); }
  @Post() create(@Body() body: { name?: string; mobile?: string; notes?: string }, @Req() request: AuthRequest) { return this.customers.create(body, request.user?.id, request.ip); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: { name?: string; mobile?: string; notes?: string; isActive?: boolean }, @Req() request: AuthRequest) { return this.customers.update(id, body, request.user?.id, request.ip); }
}
