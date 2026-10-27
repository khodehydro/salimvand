import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { ContentStudioService } from './content-studio.service';
import { StudioSnapshotDto } from './content-studio.dto';
@Controller('content-studio')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager')
export class ContentStudioController {
  constructor(private readonly studio: ContentStudioService) {}
  @Get('options') async options() {
    return { ok: true, data: await this.studio.options() };
  }
  @Post('snapshot') async snapshot(@Body() body: StudioSnapshotDto) {
    return { ok: true, data: await this.studio.snapshot(body) };
  }
}
