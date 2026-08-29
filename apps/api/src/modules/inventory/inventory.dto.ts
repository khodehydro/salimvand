import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateInventoryItemDto {
  @IsUUID() productId!: string;
  @IsUUID() brandId!: string;
  @IsOptional() @IsString() @MaxLength(20) barcode?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9_000_000_000_000_000)
  purchasePrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(9_000_000_000_000_000) salePrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) minStock?: number;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) initialQuantity?: number;
}

export class AdjustInventoryDto {
  @Type(() => Number) @IsInt() @Min(-1_000_000) @Max(1_000_000) quantity!: number;
  @IsString() @MaxLength(255) reason!: string;
}

export class ReceiveInventoryDto {
  @IsUUID() itemId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) quantity!: number;
  @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

export class TransferInventoryDto {
  @IsUUID() itemId!: string;
  @IsUUID() locationId!: string;
}

export class UpdateInventoryItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9_000_000_000_000_000)
  purchasePrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(9_000_000_000_000_000) salePrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) minStock?: number;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsString() @MaxLength(255) notes?: string;
}
