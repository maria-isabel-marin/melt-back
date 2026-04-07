import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { DocumentosService } from './documentos.service';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import type { AiProvider } from '@prisma/client';

@Controller('documentos')
@UseGuards(JwtAuthGuard)
export class DocumentosController {
  constructor(private service: DocumentosService) {}

  @Get()
  findAll(@Query('corpusId') corpusId: string, @CurrentUser() user: JwtPayload) {
    return this.service.findAllByCorpus(corpusId, user.sub);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.findOne(id, user.sub);
  }

  @Post()
  create(@Body() dto: CreateDocumentoDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(id, user.sub);
  }

  @Post(':id/analisis')
  initAnalisis(
    @Param('id') id: string,
    @Body('aiProvider') aiProvider: AiProvider = 'CLAUDE',
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.initializeAnalisis(id, user.sub, aiProvider);
  }
}
