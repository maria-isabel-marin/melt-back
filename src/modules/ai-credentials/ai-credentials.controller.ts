import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { shouldRestrictGuestPersonalAi } from '../../common/ai-access/guest-personal-ai';
import type { JwtPayload } from '../auth/auth.service';
import { AiCredentialsService } from './ai-credentials.service';
import { SaveAiCredentialDto } from './dto/save-ai-credential.dto';

@Controller('ai-credentials')
@UseGuards(JwtAuthGuard)
export class AiCredentialsController {
  constructor(
    private readonly service: AiCredentialsService,
  ) {}

  @Get()
  getStatus(
    @CurrentUser()
    user: JwtPayload,
  ) {
    return this.service.getCredentialStatus(
      user.sub,
      shouldRestrictGuestPersonalAi(
        user.isGuest,
      ),
    );
  }

  @Put()
  saveCredential(
    @Body()
    dto: SaveAiCredentialDto,

    @CurrentUser()
    user: JwtPayload,
  ) {
    return this.service.saveCredential(
      user.sub,
      shouldRestrictGuestPersonalAi(
        user.isGuest,
      ),
      dto.provider,
      dto.apiKey,
    );
  }

  @Delete(':provider')
  deleteCredential(
    @Param('provider')
    provider: AiProvider,

    @CurrentUser()
    user: JwtPayload,
  ) {
    return this.service.deleteCredential(
      user.sub,
      shouldRestrictGuestPersonalAi(
        user.isGuest,
      ),
      provider,
    );
  }
}
