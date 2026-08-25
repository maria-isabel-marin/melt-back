import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AiProvider, AiMessage, AiResponse } from '../ai-provider.interface';

type ClaudeAiResponse = AiResponse & {
  stopReason?: string | null;
};

@Injectable()
export class ClaudeProvider implements AiProvider {
  readonly providerName = 'CLAUDE';

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly logger = new Logger(ClaudeProvider.name);

  constructor(private config: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
    });

    this.model = this.config.get<string>(
      'CLAUDE_MODEL',
      'claude-sonnet-4-5',
    );

    const temperature = Number(
      this.config.get<string>('AI_TEMPERATURE', '0.1'),
    );
    this.temperature = Number.isFinite(temperature) ? temperature : 0.1;

    const configuredMaxTokens = Number(
      this.config.get<string>('CLAUDE_MAX_TOKENS', '8192'),
    );
    this.maxTokens = Number.isFinite(configuredMaxTokens)
      ? Math.min(32000, Math.max(1024, Math.round(configuredMaxTokens)))
      : 8192;
  }

  async complete(
    messages: AiMessage[],
    systemPrompt?: string,
  ): Promise<AiResponse> {
    this.logger.log(
      `Sending request to model ${this.model} with max_tokens=${this.maxTokens}`,
    );

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: systemPrompt,
      messages: messages.map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      })),
    });

    const textBlocks = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''));

    if (textBlocks.length === 0) {
      throw new Error('Unexpected response type from Claude');
    }

    const result: ClaudeAiResponse = {
      content: textBlocks.join('\n'),
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: response.stop_reason,
    };

    return result;
  }
}
