import { Controller, Get, Module } from '@nestjs/common';
import { PrismaModule } from './prisma.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { AuthModule } from './modules/auth/auth.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { MediaModule } from './modules/media/media.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { APP_NAME, API_PREFIX } from '@salimvand/shared';
import { PrismaService } from './prisma.service';
import { ServiceUnavailableException } from '@nestjs/common';

@Controller()
class SystemController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  health() {
    return { ok: true, data: { service: 'api', name: APP_NAME, prefix: API_PREFIX, database: 'pending' } };
  }

  @Get('health/ready')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, data: { service: 'api', database: 'ready' } };
    } catch {
      throw new ServiceUnavailableException('پایگاه داده در دسترس نیست');
    }
  }
}

@Module({ imports: [PrismaModule, CatalogModule, AuthModule, InventoryModule, MediaModule, DashboardModule, InvoiceModule], controllers: [SystemController] })
export class AppModule {}
