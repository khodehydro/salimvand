import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class SupplierDto {
  @IsString() @MaxLength(150) name!: string;
  @IsOptional() @Matches(/^09\d{9}$/) mobile?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(1000) address?: string;
  @IsOptional() @IsString() @MaxLength(30) taxId?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class UpdateSupplierDto extends SupplierDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
}
