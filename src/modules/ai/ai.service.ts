import { Injectable, BadRequestException } from '@nestjs/common';
import { AiProvider, AiMessage, AiResponse } from './ai-provider.interface';
import { ClaudeProvider } from './providers/claude.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { HuggingFaceProvider } from './providers/huggingface.provider';
import { AiProvider as AiProviderEnum } from '@prisma/client';

@Injectable()
export class AiService {
  private readonly providers: Record<AiProviderEnum, AiProvider>;

  constructor(
    private claude: ClaudeProvider,
    private openai: OpenAiProvider,
    private huggingface: HuggingFaceProvider,
  ) {
    this.providers = {
      CLAUDE: this.claude,
      OPENAI: this.openai,
      HUGGINGFACE: this.huggingface,
    };
  }

  async complete(
    providerName: AiProviderEnum,
    messages: AiMessage[],
    systemPrompt?: string,
  ): Promise<AiResponse> {
    const provider = this.providers[providerName];
    if (!provider) throw new BadRequestException(`AI provider not supported: ${providerName}`);
    return provider.complete(messages, systemPrompt);
  }

  async completeJson<T>(
    providerName: AiProviderEnum,
    messages: AiMessage[],
    systemPrompt?: string,
  ): Promise<T> {
    const response = await this.complete(providerName, messages, systemPrompt);
    const jsonMatch = response.content.match(/```json\s*([\s\S]*?)\s*```/);
    const raw = jsonMatch ? jsonMatch[1] : response.content;
    return JSON.parse(raw) as T;
  }
}
