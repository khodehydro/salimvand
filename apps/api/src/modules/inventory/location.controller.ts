import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { LocationService } from './location.service';

@Controller('locations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager')
export class LocationController {
  constructor(private readonly locations: LocationService) {}
  @Get() list() {
    return this.locations.list();
  }
  @Post() create(@Body() body: { name?: string; code?: string; type?: string; parentId?: string }) {
    return this.locations.create(body);
  }
}
