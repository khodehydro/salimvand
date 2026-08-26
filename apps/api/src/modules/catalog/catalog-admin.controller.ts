import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CatalogAdminService } from './catalog-admin.service';

type AuthenticatedRequest = Request & { user?: { id: string } };

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller')
export class CatalogAdminController {
  constructor(private readonly catalog: CatalogAdminService) {}
  @Get() list() { return this.catalog.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.catalog.get(id); }
  @Post() create(@Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest) { return this.catalog.create(body, request.user?.id, request.ip); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest) { return this.catalog.update(id, body, request.user?.id, request.ip); }
  @Delete(':id') remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) { return this.catalog.softDelete(id, request.user?.id, request.ip); }
  @Post(':id/restore') restore(@Param('id') id: string, @Req() request: AuthenticatedRequest) { return this.catalog.restore(id, request.user?.id, request.ip); }
}
