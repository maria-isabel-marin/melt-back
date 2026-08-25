import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AiProvider,
  AiMessage,
  AiResponse,
} from './ai-provider.interface';
import { ClaudeProvider } from './providers/claude.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { HuggingFaceProvider } from './providers/huggingface.provider';
import { AiProvider as AiProviderEnum } from '@prisma/client';

export interface AiJsonResponse<T> {
  data: T;
  response: AiResponse;
}

export type AiJsonFailureReason = 'INVALID_JSON' | 'MAX_TOKENS';

export class AiJsonResponseException extends BadGatewayException {
  constructor(
    public readonly providerName: AiProviderEnum,
    public readonly reason: AiJsonFailureReason,
    public readonly aiResponse: AiResponse,
  ) {
    super(
      reason === 'MAX_TOKENS'
        ? `AI provider ${providerName} reached its output-token limit before completing the JSON response.`
        : `AI provider ${providerName} returned invalid JSON.`,
    );
  }
}

type AiResponseWithStopReason = AiResponse & {
  stopReason?: string | null;
};

@Injectable()
export class AiService {
  private readonly providers: Record<string, AiProvider>;
  private readonly logger = new Logger(AiService.name);

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

    if (!provider) {
      throw new BadRequestException(
        `AI provider not supported: ${providerName}`,
      );
    }

    try {
      const response = await provider.complete(messages, systemPrompt);
      const stopReason = (response as AiResponseWithStopReason).stopReason;

      this.logger.log(
        `[AI] provider=${providerName} model=${response.model} ` +
          `inputTokens=${response.usage?.inputTokens ?? 0} ` +
          `outputTokens=${response.usage?.outputTokens ?? 0}` +
          (stopReason ? ` stopReason=${stopReason}` : ''),
      );

      return response;
    } catch (error) {
      if (error instanceof HttpException) throw error;

      const status = this.readHttpStatus(error);
      const message = this.readErrorMessage(error);

      this.logger.error(`[AI] provider=${providerName} error=${message}`);

      if (status !== null && status >= 400 && status <= 599) {
        throw new HttpException(
          `AI provider error (${providerName}): ${message}`,
          status,
        );
      }

      throw error;
    }
  }

  async completeJson<T>(
    providerName: AiProviderEnum,
    messages: AiMessage[],
    systemPrompt?: string,
  ): Promise<T> {
    const result = await this.completeJsonWithMeta<T>(
      providerName,
      messages,
      systemPrompt,
    );

    return result.data;
  }

  async completeJsonWithMeta<T>(
    providerName: AiProviderEnum,
    messages: AiMessage[],
    systemPrompt?: string,
  ): Promise<AiJsonResponse<T>> {
    const response = await this.complete(providerName, messages, systemPrompt);
    const stopReason = (response as AiResponseWithStopReason).stopReason;

    if (stopReason === 'max_tokens') {
      throw new AiJsonResponseException(
        providerName,
        'MAX_TOKENS',
        response,
      );
    }

    const raw = this.extractJsonCandidate(response.content);

    try {
      return {
        data: JSON.parse(raw) as T,
        response,
      };
    } catch {
      throw new AiJsonResponseException(
        providerName,
        'INVALID_JSON',
        response,
      );
    }
  }

  private extractJsonCandidate(content: string): string {
    let value = String(content ?? '').replace(/^\uFEFF/, '').trim();

    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) value = fenced[1].trim();

    try {
      JSON.parse(value);
      return value;
    } catch {
      // Intentar aislar el primer objeto JSON.
    }

    const objectStart = value.indexOf('{');
    const objectEnd = value.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return value.slice(objectStart, objectEnd + 1);
    }

    const arrayStart = value.indexOf('[');
    const arrayEnd = value.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return value.slice(arrayStart, arrayEnd + 1);
    }

    return value;
  }

  private readHttpStatus(error: unknown): number | null {
    if (typeof error !== 'object' || error === null) return null;

    const candidate =
      (error as any).status ??
      (error as any).statusCode ??
      (error as any).response?.status;

    const numeric = Number(candidate);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private readErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;

    if (typeof error === 'object' && error !== null) {
      const candidate =
        (error as any).message ?? (error as any).error?.message;
      if (candidate) return String(candidate);
    }

    return String(error);
  }
}
