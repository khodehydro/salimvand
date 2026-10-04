import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsController, PublicAnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

// AuthModule provides AuthService to JwtAuthGuard, which guards the admin
// analytics controller — without it the API fails to boot (Nest DI error).
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AnalyticsController, PublicAnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
