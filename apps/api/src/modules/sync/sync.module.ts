import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({ imports: [AuthModule], controllers: [SyncController], providers: [SyncService], exports: [SyncService] })
export class SyncModule {}
