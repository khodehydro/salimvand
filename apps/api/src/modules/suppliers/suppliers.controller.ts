import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { SuppliersService } from './suppliers.service';

type AuthRequest = Request & { user?: { id: string } };

@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'manager', 'accountant')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}
  @Get() list(@Query('search') search?: string) { return this.suppliers.list(search); }
  @Post() create(@Body() body: { name?: string; mobile?: string; phone?: string; address?: string; taxId?: string; notes?: string }, @Req() request: AuthRequest) { return this.suppliers.create(body, request.user?.id ?? '', request.ip); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: { name?: string; mobile?: string; phone?: string; address?: string; taxId?: string; notes?: string; isActive?: boolean }, @Req() request: AuthRequest) { return this.suppliers.update(id, body, request.user?.id ?? '', request.ip); }
  @Delete(':id') remove(@Param('id') id: string, @Req() request: AuthRequest) { return this.suppliers.remove(id, request.user?.id ?? '', request.ip); }
}
