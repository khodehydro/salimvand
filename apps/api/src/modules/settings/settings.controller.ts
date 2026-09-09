import { Body, Controller, Get, Put, Req, StreamableFile, UseGuards } from '@nestjs/common';
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
