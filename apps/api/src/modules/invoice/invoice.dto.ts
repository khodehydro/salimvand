import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMobilePhone,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class InvoiceItemDto {
  @IsString() inventoryItemId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) quantity!: number;
  @IsNumberString() unitPrice!: string;
}

export class CreateInvoiceDto {
  @IsOptional() @IsString() @MaxLength(150) customerName?: string;
  @IsOptional() @IsMobilePhone('fa-IR') customerMobile?: string;
  @IsOptional() @IsString() @MaxLength(500) storeAddress?: string;
  @IsOptional() @IsString() @MaxLength(30) storePhone?: string;
  @IsOptional() @IsString() @MaxLength(500) customerAddress?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(9_000_000_000_000_000) discount?: number;
  @ValidateNested({ each: true }) @Type(() => InvoiceItemDto) items!: InvoiceItemDto[];
}

/** Addresses stay editable after issue: the store snapshot may change or the
 * customer address is only filled in later (e.g. for delivery). */
export class UpdateInvoiceAddressesDto {
  @IsOptional() @IsString() @MaxLength(500) storeAddress?: string;
  @IsOptional() @IsString() @MaxLength(30) storePhone?: string;
  @IsOptional() @IsString() @MaxLength(500) customerAddress?: string;
}

export enum InvoicePaymentMethod {
  cash = 'cash',
  card = 'card',
  transfer = 'transfer',
  credit = 'credit',
}
export class PaymentCheckDto {
  @IsOptional() @IsString() @MaxLength(80) checkNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) bank?: string;
  @IsOptional() @IsString() @MaxLength(120) branch?: string;
  @IsNumberString() amount!: string;
  @IsDateString() dueDate!: string;
}
export class PayInvoiceDto {
  @IsNumberString() amount!: string;
  @IsEnum(InvoicePaymentMethod) method!: InvoicePaymentMethod;
  @IsOptional() @ValidateNested({ each: true }) @Type(() => PaymentCheckDto) checks?: PaymentCheckDto[];
}

export class ReturnInvoiceItemDto {
  @IsString() invoiceItemId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) quantity!: number;
  @IsString() @MaxLength(255) reason!: string;
  @IsOptional() @IsBoolean() restock?: boolean;
}
