import { Module } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { InvoiceController, PublicInvoiceController } from './invoice.controller';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [InvoiceController, PublicInvoiceController], providers: [InvoiceService], exports: [InvoiceService] })
export class InvoiceModule {}
