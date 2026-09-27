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

  /** Lightweight scheduler health for the panel's live status box. */
  @Get('status')
  async status() {
    return { ok: true, data: await this.githubBackup.getSchedulerStatus() };
  }

  @Post('run')
  async run(@Req() req: AuthRequest) {
    return this.githubBackup.runManual(req.user!.id);
  }

  /** Runs one scheduler pass on demand: the panel's «بررسی حالا» button.
   *  Reports whether an archive was due (and pushed) or why it was skipped,
   *  so a broken schedule is diagnosable without reading server logs. */
  @Post('tick')
  async tick() {
    return this.githubBackup.tickNow();
  }

  @Get('jobs')
  async jobs() {
    return this.githubBackup.listJobs();
  }
}
