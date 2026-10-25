import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class BulkPublishFilterDto {
  @IsIn(['all', 'vehicles', 'categories', 'brands', 'combined'])
  mode!: 'all' | 'vehicles' | 'categories' | 'brands' | 'combined';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  vehicleModelIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  brandIds?: string[];

  @IsOptional() @IsIn(['and', 'or']) match?: 'and' | 'or';
  @IsOptional() @Transform(({ obj, key }) => obj[key]) @IsBoolean() inStockOnly?: boolean;
  @IsOptional() @Transform(({ obj, key }) => obj[key]) @IsBoolean() withImageOnly?: boolean;
}

export class StartBulkPublishDto extends BulkPublishFilterDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsIn(['telegram', 'bale'], { each: true })
  platforms!: Array<'telegram' | 'bale'>;

  // A retry of the same HTTP request must not enqueue a duplicate campaign.
  @IsUUID() requestId!: string;
}
