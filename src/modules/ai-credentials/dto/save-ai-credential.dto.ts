import {
  AiProvider,
} from '@prisma/client';

export class SaveAiCredentialDto {
  provider!: AiProvider;
  apiKey!: string;
}