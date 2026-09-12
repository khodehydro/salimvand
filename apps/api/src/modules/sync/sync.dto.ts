import { IsArray, IsObject, IsOptional, IsString, MaxLength, ArrayMaxSize } from 'class-validator';

export class RegisterSyncDeviceDto {
  @IsString() @MaxLength(100) deviceId!: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
}

export class QueueSyncOperationDto {
  @IsString() @MaxLength(100) operationId!: string;
  @IsString() @MaxLength(100) deviceId!: string;
  @IsString() @MaxLength(80) type!: string;
  @IsObject() payload!: Record<string, unknown>;
}

export class SyncOperationIdsDto {
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(100, { each: true }) operationIds!: string[];
}
