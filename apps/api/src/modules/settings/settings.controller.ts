import { BadRequestException, Body, Controller, Get, Post, Put, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { SettingsService } from './settings.service';

type AuthRequest = Request & { user?: { id: string } };

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}
  @Get() list() {
    return this.settings.list();
  }
  @Get('backup/status') backupStatus() {
    return this.settings.backupStatus();
  }
  @Get('backup/jobs') backupJobs() {
    return this.settings.backupJobs();
  }
  @Post('backup/inspect')
  @UseInterceptors(FileInterceptor('file'))
  inspectBackup(@UploadedFile() file: { buffer: Buffer; originalname: string }) {
    if (!file?.buffer) throw new BadRequestException('فایل Backup انتخاب نشده است');
    return this.settings.inspectBackup(file);
  }
  @Put('backup/google-drive')
  uploadBackupToDrive() {
    return this.settings.uploadBackupToDrive();
  }
  @Post('backup/restore')
  @UseInterceptors(FileInterceptor('file'))
  restoreBackup(@UploadedFile() file: { buffer: Buffer; originalname: string }) {
    if (!file?.buffer) throw new BadRequestException('فایل Backup انتخاب نشده است');
    return this.settings.restoreBackup(file);
  }
  @Get('backup/download')
  async downloadBackup() {
    const file = await this.settings.openBackupDownload();
    return new StreamableFile(file.stream, {
      type: file.filename.endsWith('.gpg') ? 'application/octet-stream' : 'application/gzip',
      disposition: `attachment; filename="${file.filename}"`,
      length: file.size,
    });
  }
  @Put('backup/run') runBackup(@Req() request: AuthRequest) {
    return this.settings.runBackup(request.user?.id);
  }
  @Put() update(@Body() body: Record<string, unknown>, @Req() request: AuthRequest) {
    return this.settings.update(body, request.user?.id ?? '', request.ip);
  }
}
