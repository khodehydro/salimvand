import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { GithubBackupService } from './github-backup.service';
import { GithubBackupController } from './github-backup.controller';

@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [GithubBackupController],
  providers: [GithubBackupService],
  exports: [GithubBackupService],
})
export class GithubBackupModule {}
