import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';

@Module({ imports: [AuthModule], controllers: [InventoryController, LocationController], providers: [InventoryService, LocationService], exports: [InventoryService] })
export class InventoryModule {}
