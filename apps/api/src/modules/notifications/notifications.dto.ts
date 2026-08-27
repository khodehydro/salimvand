import { IsEnum, IsMobilePhone, IsOptional, IsString, MaxLength } from 'class-validator';

export enum NotificationTestChannel { sms = 'sms', telegram = 'telegram', bale = 'bale' }
export class TestNotificationDto {
  @IsEnum(NotificationTestChannel) channel!: NotificationTestChannel;
  @IsString() @MaxLength(500) message!: string;
  @IsOptional() @IsMobilePhone('fa-IR') mobile?: string;
}
