import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuppliersController } from './suppliers.controller';
import { PurchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [AuthModule],
  controllers: [SuppliersController, PurchaseController],
  providers: [SuppliersService, PurchaseService],
})
export class SuppliersModule {}
