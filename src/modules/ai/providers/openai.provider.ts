import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AiProvider, AiMessage, AiResponse } from '../ai-provider.interface';

@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly providerName = 'OPENAI';
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(private config: ConfigService) {
    this.client = new OpenAI({ apiKey: this.config.get('OPENAI_API_KEY') });
    this.model = this.config.get('OPENAI_MODEL', 'gpt-4o');
  }

  async complete(messages: AiMessage[], systemPrompt?: string): Promise<AiResponse> {
    const allMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      allMessages.push({ role: 'system', content: systemPrompt });
    }

    allMessages.push(
      ...messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
    );

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: allMessages,
    });

    return {
      content: response.choices[0].message.content ?? '',
      model: response.model,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}
