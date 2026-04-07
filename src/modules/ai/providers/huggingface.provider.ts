import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProvider, AiMessage, AiResponse } from '../ai-provider.interface';

@Injectable()
export class HuggingFaceProvider implements AiProvider {
  readonly providerName = 'HUGGINGFACE';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly apiUrl: string;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get('HUGGINGFACE_API_KEY', '');
    this.model = this.config.get('HUGGINGFACE_MODEL', 'mistralai/Mistral-7B-Instruct-v0.3');
    this.apiUrl = `https://api-inference.huggingface.co/models/${this.model}`;
  }

  async complete(messages: AiMessage[], systemPrompt?: string): Promise<AiResponse> {
    const prompt = this.buildPrompt(messages, systemPrompt);

    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 2048 } }),
    });

    if (!res.ok) throw new Error(`HuggingFace API error: ${res.statusText}`);

    const data = (await res.json()) as { generated_text: string }[];
    return {
      content: data[0]?.generated_text ?? '',
      model: this.model,
    };
  }

  private buildPrompt(messages: AiMessage[], systemPrompt?: string): string {
    let prompt = systemPrompt ? `<s>[INST] <<SYS>>\n${systemPrompt}\n<</SYS>>\n\n` : '<s>[INST] ';
    for (const msg of messages) {
      if (msg.role === 'user') prompt += `${msg.content} [/INST]`;
      else if (msg.role === 'assistant') prompt += ` ${msg.content} </s><s>[INST] `;
    }
    return prompt;
  }
}
