import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { ClaudeProvider } from './providers/claude.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { HuggingFaceProvider } from './providers/huggingface.provider';

@Module({
  providers: [AiService, ClaudeProvider, OpenAiProvider, HuggingFaceProvider],
  exports: [AiService],
})
export class AiModule {}
