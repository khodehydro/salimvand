import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CatalogAdminService } from './catalog-admin.service';
import { ProductsBackupService } from './products-backup.service';
import { SocialPublisherService } from '../notifications/social-publisher.service';

type AuthenticatedRequest = Request & { user?: { id: string } };

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager', 'warehouse')
export class CatalogAdminController {
  constructor(
    private readonly catalog: CatalogAdminService,
    private readonly backup: ProductsBackupService,
    private readonly social: SocialPublisherService,
  ) {}

  /** Full-catalog backup zip: every product field, inventory lines (brand,
   * shelf, prices, last-price date), compatibilities and the image files. */
  @Roles('manager')
  @Get('backup/export')
  async backupExport(@Res() response: Response) {
    const zip = await this.backup.buildBackup();
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="salimvand-products-backup-${new Date().toISOString().slice(0, 10)}.zip"`,
    );
    return response.send(zip);
  }

  /** Restore from a backup zip — upsert by product code, never deletes. */
  @Roles('manager')
  @Post('backup/import')
  @UseInterceptors(FileInterceptor('file'))
  async backupImport(
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('فایل پشتیبان ZIP ارسال نشده است');
    const data = await this.backup.importBackup(file.buffer, request.user?.id ?? '', request.ip);
    return { ok: true, data };
  }
  @Get('wholesale') @Roles('super_admin', 'manager', 'wholesale') wholesale() {
    return this.catalog.wholesale();
  }
  @Get() list() {
    return this.catalog.list();
  }
  @Roles('manager')
  @Post('seo-keywords/regenerate')
  regenerateKeywords() {
    return this.catalog.regenerateKeywords();
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
