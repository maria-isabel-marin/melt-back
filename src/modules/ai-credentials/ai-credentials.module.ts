import { Module } from '@nestjs/common';
import { AiCredentialsController } from './ai-credentials.controller';
import { AiCredentialsService } from './ai-credentials.service';

@Module({
  controllers: [
    AiCredentialsController,
  ],

  providers: [
    AiCredentialsService,
  ],

  exports: [
    AiCredentialsService,
  ],
})
export class AiCredentialsModule {}