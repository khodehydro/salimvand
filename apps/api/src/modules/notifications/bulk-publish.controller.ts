import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { BulkPublishService } from './bulk-publish.service';
import { BulkPublishFilterDto, StartBulkPublishDto } from './bulk-publish.dto';

@Controller('notifications/bulk-publish')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager', 'warehouse')
export class BulkPublishController {
  constructor(private readonly bulk: BulkPublishService) {}
  @Post('preview') async preview(@Body() body: BulkPublishFilterDto) {
    return { ok: true, data: await this.bulk.preview(body) };
  }
  @Post() async start(@Body() body: StartBulkPublishDto) {
    return { ok: true, data: await this.bulk.start(body) };
  }
  @Get() async list() {
    return { ok: true, data: await this.bulk.list() };
  }
  @Get(':id') async get(@Param('id', new ParseUUIDPipe()) id: string) {
    return { ok: true, data: await this.bulk.get(id) };
  }
  @Post(':id/cancel') async cancel(@Param('id', new ParseUUIDPipe()) id: string) {
    return { ok: true, data: await this.bulk.cancel(id) };
  }
}
