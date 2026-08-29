import { Type } from 'class-transformer';
import {
  IsBoolean,
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
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(9_000_000_000_000_000) discount?: number;
  @ValidateNested({ each: true }) @Type(() => InvoiceItemDto) items!: InvoiceItemDto[];
}

export enum InvoicePaymentMethod {
  cash = 'cash',
  card = 'card',
  transfer = 'transfer',
  credit = 'credit',
}
export class PayInvoiceDto {
  @IsNumberString() amount!: string;
  @IsEnum(InvoicePaymentMethod) method!: InvoicePaymentMethod;
}

export class ReturnInvoiceItemDto {
  @IsString() invoiceItemId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) quantity!: number;
  @IsString() @MaxLength(255) reason!: string;
  @IsOptional() @IsBoolean() restock?: boolean;
}
