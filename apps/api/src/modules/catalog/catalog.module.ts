import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogAdminService } from './catalog-admin.service';
import { ReferenceController } from './reference.controller';
import { ReferenceService } from './reference.service';
import { CompatibilityController } from './compatibility.controller';
import { CompatibilityService } from './compatibility.service';

@Module({
  imports: [AuthModule],
  controllers: [
    CatalogController,
    CatalogAdminController,
    ReferenceController,
    CompatibilityController,
  ],
  providers: [CatalogService, CatalogAdminService, ReferenceService, CompatibilityService],
  exports: [CatalogAdminService],
})
export class CatalogModule {}
