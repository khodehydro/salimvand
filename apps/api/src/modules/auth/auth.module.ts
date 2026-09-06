import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { LoginRateLimitGuard } from '../../common/auth/login-rate-limit.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, EmailService, LoginRateLimitGuard],
  exports: [AuthService],
})
export class AuthModule {}
