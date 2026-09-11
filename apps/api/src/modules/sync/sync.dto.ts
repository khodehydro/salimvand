import { IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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
  @IsUUID('4', { each: true }) operationIds!: string[];
}
