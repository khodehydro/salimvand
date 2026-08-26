import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CatalogAdminService } from './catalog-admin.service';

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller')
export class CatalogAdminController {
  constructor(private readonly catalog: CatalogAdminService) {}
  @Get() list() { return this.catalog.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.catalog.get(id); }
  @Post() create(@Body() body: Record<string, unknown>) { return this.catalog.create(body); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.catalog.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.catalog.softDelete(id); }
  @Post(':id/restore') restore(@Param('id') id: string) { return this.catalog.restore(id); }
}
