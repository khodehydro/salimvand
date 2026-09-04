import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CatalogAdminService } from './catalog-admin.service';
import { SocialPublisherService } from '../notifications/social-publisher.service';

type AuthenticatedRequest = Request & { user?: { id: string } };

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager', 'warehouse')
export class CatalogAdminController {
  constructor(
    private readonly catalog: CatalogAdminService,
    private readonly social: SocialPublisherService,
  ) {}
  @Get() list() {
    return this.catalog.list();
  }
  @Get(':id') get(@Param('id') id: string) {
    return this.catalog.get(id);
  }
  @Roles('manager')
  @Post()
  create(@Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.catalog.create(body, request.user?.id, request.ip);
  }
  @Roles('manager')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.catalog.update(id, body, request.user?.id, request.ip);
  }
  @Roles('manager')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.catalog.softDelete(id, request.user?.id, request.ip);
  }
  @Roles('manager')
  @Post(':id/restore')
  restore(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.catalog.restore(id, request.user?.id, request.ip);
  }

  /** Publishes the product announcement to the Telegram/Bale channels. */
  @Roles('manager')
  @Post(':id/publish')
  async publish(@Param('id') id: string) {
    return { ok: true, data: await this.social.publishProduct(id) };
  }
}
