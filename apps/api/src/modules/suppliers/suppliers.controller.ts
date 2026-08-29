import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { SuppliersService } from './suppliers.service';
import { SupplierDto, UpdateSupplierDto } from './suppliers.dto';

type AuthRequest = Request & { user?: { id: string } };

@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'manager', 'accountant')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}
  @Get() list(@Query('search') search?: string) { return this.suppliers.list(search); }
  @Get('debtors') debtors() { return this.suppliers.debtors(); }
  @Get(':id') get(@Param('id') id: string) { return this.suppliers.get(id); }
  @Post() @Roles('manager') create(@Body() body: SupplierDto, @Req() request: AuthRequest) { return this.suppliers.create(body, request.user?.id ?? '', request.ip); }
  @Patch(':id') @Roles('manager') update(@Param('id') id: string, @Body() body: UpdateSupplierDto, @Req() request: AuthRequest) { return this.suppliers.update(id, body, request.user?.id ?? '', request.ip); }
  @Delete(':id') @Roles('manager') remove(@Param('id') id: string, @Req() request: AuthRequest) { return this.suppliers.remove(id, request.user?.id ?? '', request.ip); }
}
