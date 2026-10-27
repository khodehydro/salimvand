import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { STUDIO_MAX_PRODUCTS } from '@salimvand/shared';
export class StudioSnapshotDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() vehicleModelId?: string;
  @IsOptional() @IsUUID() vehicleMakeId?: string;
  @IsOptional() @IsUUID() brandId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(STUDIO_MAX_PRODUCTS)
  @IsUUID('all', { each: true })
  productIds?: string[];
  // Read raw values to avoid implicit conversion treating the string "false" as true.
  @Transform(({ obj }) => obj.showPrices ?? false) @IsBoolean() showPrices = false;
  @Transform(({ obj }) => obj.inStock ?? false) @IsBoolean() inStock = false;
}
