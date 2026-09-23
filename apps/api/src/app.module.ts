import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { AuthModule } from './modules/auth/auth.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { MediaModule } from './modules/media/media.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NotificationsService } from './modules/notifications/notifications.service';
import { ReportsModule } from './modules/reports/reports.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SearchModule } from './modules/search/search.module';
import { UsersModule } from './modules/users/users.module';
import { CustomersModule } from './modules/customers/customers.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { AuditModule } from './modules/audit/audit.module';
import { SyncModule } from './modules/sync/sync.module';
import { SystemController } from './system.controller';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    CatalogModule,
    AuthModule,
    InventoryModule,
    MediaModule,
    DashboardModule,
    InvoiceModule,
    NotificationsModule,
    ReportsModule,
    SettingsModule,
    SearchModule,
    UsersModule,
    CustomersModule,
    SuppliersModule,
    AuditModule,
    SyncModule,
  ],
  controllers: [SystemController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
