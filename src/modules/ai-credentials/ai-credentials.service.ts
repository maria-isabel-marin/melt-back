import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  AiProvider,
} from '@prisma/client';
import {
  ConfigService,
} from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';
import {
  PrismaService,
} from '../../prisma/prisma.service';

type SupportedPersonalProvider =
  | 'OPENAI'
  | 'CLAUDE';

type EncryptedPayload = {
  iv: string;
  authTag: string;
  ciphertext: string;
};

@Injectable()
export class AiCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getCredentialStatus(
    userId: string,
    isGuest: boolean,
  ) {
    if (isGuest) {
      return {
        canUsePersonalCredentials: false,

        credentials: {
          OPENAI: {
            configured: false,
            keyHint: null,
          },

          CLAUDE: {
            configured: false,
            keyHint: null,
          },
        },
      };
    }

    const credentials =
      await this.prisma.userAiCredential.findMany({
        where: {
          userId,

          provider: {
            in: [
              'OPENAI',
              'CLAUDE',
            ],
          },
        },

        select: {
          provider: true,
          keyHint: true,
        },
      });

    const byProvider =
      new Map(
        credentials.map(
          (credential) => [
            credential.provider,
            credential,
          ],
        ),
      );

    return {
      canUsePersonalCredentials: true,

      credentials: {
        OPENAI: {
          configured:
            byProvider.has('OPENAI'),

          keyHint:
            byProvider.get('OPENAI')
              ?.keyHint ?? null,
        },

        CLAUDE: {
          configured:
            byProvider.has('CLAUDE'),

          keyHint:
            byProvider.get('CLAUDE')
              ?.keyHint ?? null,
        },
      },
    };
  }

  async saveCredential(
    userId: string,
    isGuest: boolean,
    provider: AiProvider,
    apiKey: string,
  ) {
    this.assertPersistentCredentialsAllowed(
      isGuest,
    );

    const supportedProvider =
      this.assertSupportedProvider(
        provider,
      );

    const normalizedKey =
      this.normalizeApiKey(
        supportedProvider,
        apiKey,
      );

    const encryptedApiKey =
      this.encrypt(normalizedKey);

    const keyHint =
      this.createKeyHint(
        normalizedKey,
      );

    await this.prisma.userAiCredential.upsert({
      where: {
        userId_provider: {
          userId,
          provider:
            supportedProvider,
        },
      },

      create: {
        userId,
        provider:
          supportedProvider,
        encryptedApiKey,
        keyHint,
      },

      update: {
        encryptedApiKey,
        keyHint,
      },
    });

    return {
      provider:
        supportedProvider,

      configured:
        true,

      keyHint,
    };
  }

  async deleteCredential(
    userId: string,
    isGuest: boolean,
    provider: AiProvider,
  ) {
    this.assertPersistentCredentialsAllowed(
      isGuest,
    );

    const supportedProvider =
      this.assertSupportedProvider(
        provider,
      );

    const result =
      await this.prisma.userAiCredential.deleteMany({
        where: {
          userId,

          provider:
            supportedProvider,
        },
      });

    if (
      result.count === 0
    ) {
      throw new NotFoundException(
        `No personal credential is configured for ${supportedProvider}.`,
      );
    }

    return {
      provider:
        supportedProvider,

      configured:
        false,

      keyHint:
        null,
    };
  }

  /**
   * Solo debe utilizarse internamente en el backend.
   *
   * Nunca expongas el resultado de este método mediante
   * un controller o una respuesta HTTP.
   */
  async getDecryptedCredential(
    userId: string,
    provider: AiProvider,
  ): Promise<string | null> {
    const supportedProvider =
      this.assertSupportedProvider(
        provider,
      );

    const credential =
      await this.prisma.userAiCredential.findUnique({
        where: {
          userId_provider: {
            userId,

            provider:
              supportedProvider,
          },
        },

        select: {
          encryptedApiKey: true,
        },
      });

    if (!credential) {
      return null;
    }

    return this.decrypt(
      credential.encryptedApiKey,
    );
  }

  async hasCredential(
    userId: string,
    provider: AiProvider,
  ): Promise<boolean> {
    const supportedProvider =
      this.assertSupportedProvider(
        provider,
      );

    const credential =
      await this.prisma.userAiCredential.findUnique({
        where: {
          userId_provider: {
            userId,

            provider:
              supportedProvider,
          },
        },

        select: {
          id: true,
        },
      });

    return Boolean(
      credential,
    );
  }

  private assertPersistentCredentialsAllowed(
    isGuest: boolean,
  ) {
    if (isGuest) {
      throw new ForbiddenException(
        'Guest sessions cannot store personal AI credentials.',
      );
    }
  }

  private assertSupportedProvider(
    provider: AiProvider,
  ): SupportedPersonalProvider {
    if (
      provider !== 'OPENAI' &&
      provider !== 'CLAUDE'
    ) {
      throw new BadRequestException(
        'Personal API credentials are supported only for OPENAI and CLAUDE.',
      );
    }

    return provider;
  }

  private normalizeApiKey(
    provider: SupportedPersonalProvider,
    value: unknown,
  ): string {
    if (
      typeof value !== 'string'
    ) {
      throw new BadRequestException(
        'API key must be a string.',
      );
    }

    const apiKey =
      value.trim();

    if (!apiKey) {
      throw new BadRequestException(
        'API key cannot be empty.',
      );
    }

    if (
      apiKey.length < 10
    ) {
      throw new BadRequestException(
        `The ${provider} API key appears to be invalid.`,
      );
    }

    if (
      apiKey.length > 1000
    ) {
      throw new BadRequestException(
        'API key is too long.',
      );
    }

    if (
      /[\r\n]/.test(apiKey)
    ) {
      throw new BadRequestException(
        'API key cannot contain line breaks.',
      );
    }

    return apiKey;
  }

  private createKeyHint(
    apiKey: string,
  ): string {
    const visibleCharacters =
      Math.min(
        4,
        apiKey.length,
      );

    return `••••${apiKey.slice(
      -visibleCharacters,
    )}`;
  }

  private encrypt(
    value: string,
  ): string {
    const encryptionKey =
      this.getEncryptionKey();

    const iv =
      randomBytes(12);

    const cipher =
      createCipheriv(
        'aes-256-gcm',
        encryptionKey,
        iv,
      );

    const ciphertext =
      Buffer.concat([
        cipher.update(
          value,
          'utf8',
        ),

        cipher.final(),
      ]);

    const authTag =
      cipher.getAuthTag();

    const payload:
      EncryptedPayload = {
      iv:
        iv.toString(
          'base64',
        ),

      authTag:
        authTag.toString(
          'base64',
        ),

      ciphertext:
        ciphertext.toString(
          'base64',
        ),
    };

    return JSON.stringify(
      payload,
    );
  }

  private decrypt(
    encryptedValue: string,
  ): string {
    try {
      const payload =
        JSON.parse(
          encryptedValue,
        ) as EncryptedPayload;

      if (
        !payload.iv ||
        !payload.authTag ||
        !payload.ciphertext
      ) {
        throw new Error(
          'Invalid encrypted credential payload.',
        );
      }

      const decipher =
        createDecipheriv(
          'aes-256-gcm',
          this.getEncryptionKey(),
          Buffer.from(
            payload.iv,
            'base64',
          ),
        );

      decipher.setAuthTag(
        Buffer.from(
          payload.authTag,
          'base64',
        ),
      );

      const plaintext =
        Buffer.concat([
          decipher.update(
            Buffer.from(
              payload.ciphertext,
              'base64',
            ),
          ),

          decipher.final(),
        ]);

      return plaintext.toString(
        'utf8',
      );
    } catch {
      throw new InternalServerErrorException(
        'Stored AI credential could not be decrypted.',
      );
    }
  }

  private getEncryptionKey(): Buffer {
    const rawKey =
      this.config.get<string>(
        'AI_CREDENTIAL_ENCRYPTION_KEY',
      );

    if (!rawKey) {
      throw new InternalServerErrorException(
        'AI_CREDENTIAL_ENCRYPTION_KEY is not configured in the backend.',
      );
    }

    let decoded: Buffer;

    try {
      decoded =
        Buffer.from(
          rawKey,
          'base64',
        );
    } catch {
      throw new InternalServerErrorException(
        'AI_CREDENTIAL_ENCRYPTION_KEY is invalid.',
      );
    }

    if (
      decoded.length !== 32
    ) {
      throw new InternalServerErrorException(
        'AI_CREDENTIAL_ENCRYPTION_KEY must be a Base64-encoded 32-byte key.',
      );
    }

    return decoded;
  }
}