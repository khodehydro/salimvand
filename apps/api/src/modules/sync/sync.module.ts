import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({ imports: [AuthModule, InventoryModule], controllers: [SyncController], providers: [SyncService], exports: [SyncService] })
export class SyncModule {}
