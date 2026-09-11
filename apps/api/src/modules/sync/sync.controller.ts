import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RegisterSyncDeviceDto, QueueSyncOperationDto, SyncOperationIdsDto } from './sync.dto';
import { SyncService } from './sync.service';

type AuthenticatedRequest = Request & { user?: { id: string } };
@Controller('sync')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'manager', 'seller', 'warehouse', 'accountant')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('devices') register(@Body() body: RegisterSyncDeviceDto, @Req() request: AuthenticatedRequest) {
    return this.sync.registerDevice(request.user?.id ?? '', body.deviceId, body.name);
  }

  @Get('bootstrap') bootstrap(@Headers('x-device-id') deviceId: string, @Req() request: AuthenticatedRequest) {
    return this.sync.bootstrap(request.user?.id ?? '', deviceId);
  }

  @Get('pull') pull(@Headers('x-device-id') deviceId: string, @Query('cursor') cursor: string | undefined, @Query('limit') limit: string | undefined, @Req() request: AuthenticatedRequest) {
    return this.sync.pull(request.user?.id ?? '', deviceId, cursor, limit);
  }

  @Post('operations') queue(@Body() body: QueueSyncOperationDto, @Req() request: AuthenticatedRequest) {
    return this.sync.queueOperation(request.user?.id ?? '', body);
  }

  @Post('operations/status') statuses(@Body() body: SyncOperationIdsDto, @Req() request: AuthenticatedRequest) {
    return this.sync.operations(request.user?.id ?? '', body.operationIds);
  }

  @Get('conflicts') conflicts(@Query('status') status: 'open' | 'resolved' | undefined, @Req() request: AuthenticatedRequest) {
    return this.sync.conflicts(request.user?.id ?? '', status);
  }

  @Post('conflicts/:id/resolve') resolve(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.sync.resolveConflict(request.user?.id ?? '', id, body);
  }
}
