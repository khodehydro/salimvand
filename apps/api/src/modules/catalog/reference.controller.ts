import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { ReferenceService } from './reference.service';

const managementGuards = [JwtAuthGuard, RolesGuard];

@Controller()
export class ReferenceController {
  constructor(private readonly refs: ReferenceService) {}
  @Get('categories') categories() { return this.refs.categories(); }
  @Get('brands') brands() { return this.refs.brands(); }
  @Get('vehicles/tree') vehicles() { return this.refs.vehicles(); }

  @UseGuards(...managementGuards) @Roles('manager') @Get('references') adminList() { return this.refs.adminList(); }
  @UseGuards(...managementGuards) @Roles('manager') @Post('categories') createCategory(@Body() body: Record<string, unknown>) { return this.refs.createCategory(body); }
  @UseGuards(...managementGuards) @Roles('manager') @Patch('categories/:id') updateCategory(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.refs.updateCategory(id, body); }
  @UseGuards(...managementGuards) @Roles('manager') @Delete('categories/:id') disableCategory(@Param('id') id: string) { return this.refs.setCategoryActive(id, false); }
  @UseGuards(...managementGuards) @Roles('manager') @Post('categories/:id/restore') restoreCategory(@Param('id') id: string) { return this.refs.setCategoryActive(id, true); }

  @UseGuards(...managementGuards) @Roles('manager') @Post('brands') createBrand(@Body() body: Record<string, unknown>) { return this.refs.createBrand(body); }
  @UseGuards(...managementGuards) @Roles('manager') @Patch('brands/:id') updateBrand(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.refs.updateBrand(id, body); }
  @UseGuards(...managementGuards) @Roles('manager') @Delete('brands/:id') disableBrand(@Param('id') id: string) { return this.refs.setBrandActive(id, false); }
  @UseGuards(...managementGuards) @Roles('manager') @Post('brands/:id/restore') restoreBrand(@Param('id') id: string) { return this.refs.setBrandActive(id, true); }

  @UseGuards(...managementGuards) @Roles('manager') @Post('vehicles/makes') createMake(@Body() body: Record<string, unknown>) { return this.refs.createMake(body); }
  @UseGuards(...managementGuards) @Roles('manager') @Patch('vehicles/makes/:id') updateMake(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.refs.updateMake(id, body); }
  @UseGuards(...managementGuards) @Roles('manager') @Post('vehicles/makes/:makeId/models') createModel(@Param('makeId') makeId: string, @Body() body: Record<string, unknown>) { return this.refs.createModel(makeId, body); }
  @UseGuards(...managementGuards) @Roles('manager') @Patch('vehicles/models/:id') updateModel(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.refs.updateModel(id, body); }
  @UseGuards(...managementGuards) @Roles('manager') @Post('vehicles/models/:modelId/trims') createTrim(@Param('modelId') modelId: string, @Body() body: Record<string, unknown>) { return this.refs.createTrim(modelId, body); }
  @UseGuards(...managementGuards) @Roles('manager') @Patch('vehicles/trims/:id') updateTrim(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.refs.updateTrim(id, body); }
}
