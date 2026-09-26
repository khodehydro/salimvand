import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { LocationService } from './location.service';

type AuthenticatedRequest = Request & { user?: { id: string } };

@Controller('locations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager')
export class LocationController {
  constructor(private readonly locations: LocationService) {}
  // Warehouse staff run the inventory page (transfers, shelf cards) and need
  // the list, but creating/renaming/deleting locations stays a manager task.
  @Roles('manager', 'warehouse')
  @Get()
  list(@Query('type') type?: string, @Query('parentId') parentId?: string) {
    return this.locations.list({ type, parentId });
  }
  @Post() create(
    @Body() body: { name?: string; code?: string; type?: string; parentId?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.locations.create({ ...body, userId: request.user?.id, ip: request.ip });
  }
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; code?: string; type?: string; parentId?: string | null },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.locations.update(id, { ...body, userId: request.user?.id, ip: request.ip });
  }
  @Delete(':id')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.locations.remove(id, request.user?.id, request.ip);
  }
}
