export interface AiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type AiCredentialSource = 'MELT' | 'PERSONAL';

export interface AiCompletionOptions {
  /**
   * API key que debe utilizarse únicamente para esta solicitud.
   *
   * Si no se proporciona, el provider usa la credencial de MELT
   * configurada en las variables de entorno del backend.
   *
   * Esta clave nunca debe registrarse en logs.
   */
  apiKey?: string;

  /**
   * Indica de dónde procede la credencial usada en la ejecución.
   */
  credentialSource?: AiCredentialSource;
}

export interface AiResponse {
  content: string;
  model: string;

  usage?: {
    inputTokens: number;
    outputTokens: number;
  };

  /**
   * Razón de finalización normalizada cuando el proveedor la ofrece.
   */
  stopReason?: string | null;

  /**
   * Fuente de la credencial utilizada.
   *
   * Nunca contiene la API key.
   */
  credentialSource?: AiCredentialSource;
}

export interface AiProvider {
  readonly providerName: string;

  complete(
    messages: AiMessage[],
    systemPrompt?: string,
    options?: AiCompletionOptions,
  ): Promise<AiResponse>;
}