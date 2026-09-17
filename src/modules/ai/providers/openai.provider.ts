import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  AiCompletionOptions,
  AiCredentialSource,
  AiMessage,
  AiProvider,
  AiResponse,
} from '../ai-provider.interface';

@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly providerName = 'OPENAI';

  private readonly sharedClient: OpenAI;
  private readonly model: string;
  private readonly temperature: number;
  private readonly logger =
    new Logger(OpenAiProvider.name);

  constructor(
    private config: ConfigService,
  ) {
    this.sharedClient = new OpenAI({
      apiKey:
        this.config.get<string>(
          'OPENAI_API_KEY',
        ),
    });

    this.model =
      this.config.get<string>(
        'OPENAI_MODEL',
        'gpt-4o-mini',
      );

    const configuredTemperature =
      Number(
        this.config.get<string>(
          'AI_TEMPERATURE',
          '0.1',
        ),
      );

    this.temperature =
      Number.isFinite(
        configuredTemperature,
      )
        ? configuredTemperature
        : 0.1;
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

    const allMessages:
      OpenAI.Chat.ChatCompletionMessageParam[] =
      [];

    if (systemPrompt) {
      allMessages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    allMessages.push(
      ...messages.map(
        (message) => ({
          role: message.role as
            | 'user'
            | 'assistant'
            | 'system',

          content:
            message.content,
        }),
      ),
    );

    this.logger.log(
      `Sending request to model ${this.model} ` +
        `using ${credentialSource} credentials`,
    );

    const response =
      await client.chat.completions.create({
        model:
          this.model,

        messages:
          allMessages,

        temperature:
          this.temperature,

        max_tokens:
          4096,

        response_format: {
          type: 'json_object',
        },
      });

    const finishReason =
      response.choices[0]?.finish_reason ??
      null;

    return {
      content:
        response.choices[0]
          ?.message?.content ?? '',

      model:
        response.model,

      usage: {
        inputTokens:
          response.usage
            ?.prompt_tokens ?? 0,

        outputTokens:
          response.usage
            ?.completion_tokens ?? 0,
      },

      /**
       * OpenAI usa "length" cuando la generación
       * termina por límite de salida.
       *
       * Lo normalizamos a "max_tokens" para que
       * AiService pueda tratar OpenAI y Claude
       * de la misma manera.
       */
      stopReason:
        finishReason === 'length'
          ? 'max_tokens'
          : finishReason,

      credentialSource,
    };
  }

  private resolveClient(
    options?: AiCompletionOptions,
  ): {
    client: OpenAI;
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
          'Personal OpenAI API key was requested but no key was provided.',
        );
      }

      return {
        client: new OpenAI({
          apiKey: personalApiKey,
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