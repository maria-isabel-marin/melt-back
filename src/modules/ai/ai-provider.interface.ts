export interface AiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AiResponse {
  content: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AiProvider {
  complete(messages: AiMessage[], systemPrompt?: string): Promise<AiResponse>;
  readonly providerName: string;
}
