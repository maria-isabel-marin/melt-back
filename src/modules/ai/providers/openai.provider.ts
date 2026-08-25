import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AiProvider, AiMessage, AiResponse } from '../ai-provider.interface';

@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly providerName = 'OPENAI';

  private readonly client: OpenAI;
  private readonly model: string;
  private readonly temperature: number;
  private readonly logger = new Logger(OpenAiProvider.name);

  constructor(private config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.get<string>('OPENAI_API_KEY'),
    });

    this.model = this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
    this.temperature = Number(this.config.get<string>('AI_TEMPERATURE', '0.1'));
  }

  async complete(
    messages: AiMessage[],
    systemPrompt?: string,
  ): Promise<AiResponse> {
    const allMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      allMessages.push({ role: 'system', content: systemPrompt });
    }

    allMessages.push(
      ...messages.map((message) => ({
        role: message.role as 'user' | 'assistant' | 'system',
        content: message.content,
      })),
    );

    this.logger.log(`Sending request to model ${this.model}`);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: allMessages,
      temperature: Number.isFinite(this.temperature) ? this.temperature : 0.1,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    });

    return {
      content: response.choices[0]?.message?.content ?? '',
      model: response.model,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}
