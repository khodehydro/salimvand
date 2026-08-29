import {
  IsBoolean,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CustomerDto {
  @IsString() @MaxLength(150) name!: string;
  @Matches(/^09\d{9}$/) mobile!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class UpdateCustomerDto {
  @IsOptional() @IsString() @MaxLength(150) name?: string;
  @IsOptional() @Matches(/^09\d{9}$/) mobile?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export enum CustomerPaymentMethod {
  cash = 'cash',
  card = 'card',
  transfer = 'transfer',
  credit = 'credit',
}
export class CustomerPaymentDto {
  @IsNumberString() amount!: string;
  @IsEnum(CustomerPaymentMethod) method!: CustomerPaymentMethod;
  @IsOptional() @IsUUID() invoiceId?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
