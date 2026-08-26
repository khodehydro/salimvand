import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { ReferenceService } from './reference.service';

@Controller()
export class ReferenceController {
  constructor(private readonly refs: ReferenceService) {}
  @Get('categories') categories() { return this.refs.categories(); }
  @Get('brands') brands() { return this.refs.brands(); }
  @Get('vehicles/tree') vehicles() { return this.refs.vehicles(); }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('manager') @Post('categories') createCategory(@Body() body: Record<string, unknown>) { return this.refs.createCategory(body); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('manager') @Post('brands') createBrand(@Body() body: Record<string, unknown>) { return this.refs.createBrand(body); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('manager') @Post('vehicles/makes') createMake(@Body() body: Record<string, unknown>) { return this.refs.createMake(body); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('manager') @Post('vehicles/makes/:makeId/models') createModel(@Param('makeId') makeId: string, @Body() body: Record<string, unknown>) { return this.refs.createModel(makeId, body); }
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('manager') @Post('vehicles/models/:modelId/trims') createTrim(@Param('modelId') modelId: string, @Body() body: Record<string, unknown>) { return this.refs.createTrim(modelId, body); }
}
