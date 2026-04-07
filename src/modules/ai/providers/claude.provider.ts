import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AiProvider, AiMessage, AiResponse } from '../ai-provider.interface';

@Injectable()
export class ClaudeProvider implements AiProvider {
  readonly providerName = 'CLAUDE';
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly logger = new Logger(ClaudeProvider.name);

  constructor(private config: ConfigService) {
    this.client = new Anthropic({ apiKey: this.config.get('ANTHROPIC_API_KEY') });
    this.model = this.config.get('CLAUDE_MODEL', 'claude-opus-4-6');
  }

  async complete(messages: AiMessage[], systemPrompt?: string): Promise<AiResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8096,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

    return {
      content: content.text,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
