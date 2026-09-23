import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CatalogModule } from '../catalog/catalog.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({ imports: [AuthModule, InventoryModule, CatalogModule, InvoiceModule, SuppliersModule], controllers: [SyncController], providers: [SyncService], exports: [SyncService] })
export class SyncModule {}
