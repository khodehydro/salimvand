import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { GithubBackupService } from './github-backup.service';

type AuthRequest = Request & { user?: { id: string } };

@Controller('settings/github-backup')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'manager')
export class GithubBackupController {
  constructor(private readonly githubBackup: GithubBackupService) {}

  @Get()
  async getConfig() {
    return { ok: true, data: await this.githubBackup.getPublicConfig() };
  }

  @Put()
  async saveConfig(@Body() body: any, @Req() req: AuthRequest) {
    const data = await this.githubBackup.saveConfig(body, req.user!.id);
    return { ok: true, data };
  }

  @Post('run')
  async run(@Req() req: AuthRequest) {
    return this.githubBackup.runManual(req.user!.id);
  }

  @Get('jobs')
  async jobs() {
    return this.githubBackup.listJobs();
  }
}
