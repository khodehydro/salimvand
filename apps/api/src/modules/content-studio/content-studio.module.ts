import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContentStudioService } from './content-studio.service';
import { ContentStudioController } from './content-studio.controller';
@Module({
  imports: [AuthModule],
  controllers: [ContentStudioController],
  providers: [ContentStudioService],
})
export class ContentStudioModule {}
