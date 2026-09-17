import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  AiCompletionOptions,
  AiCredentialSource,
  AiMessage,
  AiProvider,
  AiResponse,
} from '../ai-provider.interface';

@Injectable()
export class ClaudeProvider implements AiProvider {
  readonly providerName = 'CLAUDE';

  private readonly sharedClient: Anthropic;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly logger =
    new Logger(ClaudeProvider.name);

  constructor(
    private config: ConfigService,
  ) {
    this.sharedClient =
      new Anthropic({
        apiKey:
          this.config.get<string>(
            'ANTHROPIC_API_KEY',
          ),
      });

    this.model =
      this.config.get<string>(
        'CLAUDE_MODEL',
        'claude-sonnet-4-5',
      );

    const temperature =
      Number(
        this.config.get<string>(
          'AI_TEMPERATURE',
          '0.1',
        ),
      );

    this.temperature =
      Number.isFinite(
        temperature,
      )
        ? temperature
        : 0.1;

    const configuredMaxTokens =
      Number(
        this.config.get<string>(
          'CLAUDE_MAX_TOKENS',
          '8192',
        ),
      );

    this.maxTokens =
      Number.isFinite(
        configuredMaxTokens,
      )
        ? Math.min(
            32000,
            Math.max(
              1024,
              Math.round(
                configuredMaxTokens,
              ),
            ),
          )
        : 8192;
  }

  async complete(
    messages: AiMessage[],
    systemPrompt?: string,
    options?: AiCompletionOptions,
  ): Promise<AiResponse> {
    const {
      client,
      credentialSource,
    } = this.resolveClient(options);

    this.logger.log(
      `Sending request to model ${this.model} ` +
        `with max_tokens=${this.maxTokens} ` +
        `using ${credentialSource} credentials`,
    );

    const response =
      await client.messages.create({
        model:
          this.model,

        max_tokens:
          this.maxTokens,

        temperature:
          this.temperature,

        system:
          systemPrompt,

        messages:
          messages.map(
            (message) => ({
              role:
                message.role as
                  | 'user'
                  | 'assistant',

              content:
                message.content,
            }),
          ),
      });

    const textBlocks =
      response.content
        .filter(
          (block) =>
            block.type ===
            'text',
        )
        .map((block) =>
          block.type === 'text'
            ? block.text
            : '',
        );

    if (
      textBlocks.length === 0
    ) {
      throw new Error(
        'Unexpected response type from Claude',
      );
    }

    return {
      content:
        textBlocks.join('\n'),

      model:
        response.model,

      usage: {
        inputTokens:
          response.usage
            .input_tokens,

        outputTokens:
          response.usage
            .output_tokens,
      },

      stopReason:
        response.stop_reason,

      credentialSource,
    };
  }

  private resolveClient(
    options?: AiCompletionOptions,
  ): {
    client: Anthropic;
    credentialSource: AiCredentialSource;
  } {
    const personalApiKey =
      options?.apiKey?.trim();

    const requestedPersonal =
      options?.credentialSource ===
        'PERSONAL' ||
      Boolean(personalApiKey);

    if (requestedPersonal) {
      if (!personalApiKey) {
        throw new Error(
          'Personal Anthropic API key was requested but no key was provided.',
        );
      }

      return {
        client:
          new Anthropic({
            apiKey:
              personalApiKey,
          }),

        credentialSource:
          'PERSONAL',
      };
    }

    return {
      client:
        this.sharedClient,

      credentialSource:
        'MELT',
    };
  }
}