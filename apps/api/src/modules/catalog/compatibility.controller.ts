import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CompatibilityService } from './compatibility.service';

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager')
export class CompatibilityController {
  constructor(private readonly service: CompatibilityService) {}
  @Put(':id/compat') replace(@Param('id') productId: string, @Body() body: { vehicles?: Array<{ modelId: string; trimId?: string | null }> }) { return this.service.replace(productId, body.vehicles ?? []); }
}
