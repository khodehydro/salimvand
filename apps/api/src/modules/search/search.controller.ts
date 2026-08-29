import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { SearchService } from './search.service';

@Controller('search')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller')
export class SearchController {
  constructor(private readonly search: SearchService) {}
  @Get() all(@Query('q') query = '') {
    return this.search.all(query);
  }
}
