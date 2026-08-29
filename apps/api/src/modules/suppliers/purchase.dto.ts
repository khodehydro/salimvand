import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  IsInt,
} from 'class-validator';

export class PurchaseLineDto {
  @IsUUID() inventoryItemId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) quantity!: number;
  @IsNumberString() unitPrice!: string;
}
export class CreatePurchaseDto {
  @IsUUID() supplierId!: string;
  @IsOptional() @IsNumberString() paidAmount?: string;
  @ValidateNested({ each: true }) @Type(() => PurchaseLineDto) lines!: PurchaseLineDto[];
}
export enum SupplierPaymentMethod {
  cash = 'cash',
  card = 'card',
  transfer = 'transfer',
  credit = 'credit',
}
export class SupplierPaymentDto {
  @IsNumberString() amount!: string;
  @IsEnum(SupplierPaymentMethod) method!: SupplierPaymentMethod;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
