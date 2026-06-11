import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { DocumentosService } from './documentos.service';
import { IngestionService } from './ingestion.service';
import { IngestDocumentoDto } from './dto/ingest-documento.dto';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { AiProvider, Language, DocumentType } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('documentos')
@UseGuards(JwtAuthGuard)
export class DocumentosController {
  constructor(private service: DocumentosService, private ingestionService: IngestionService)   {}

  @Get()
  findAll(@Query('corpusId') corpusId: string, @CurrentUser() user: JwtPayload) {
    return this.service.findAllByCorpus(corpusId, user.sub);
  }

  @Post('ingest')
  ingest(@Body() dto: IngestDocumentoDto, @CurrentUser() user: JwtPayload) {
    return this.ingestionService.ingest(dto, user.sub);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('corpusId') corpusId: string,
    @Body('title') title: string,
    @CurrentUser() user: JwtPayload,
    @Body('author') author?: string,
    @Body('language') language?: Language,
    @Body('documentType') documentType?: DocumentType,
    @Body('description') description?: string,
    
    
  ) {
    return this.ingestionService.ingestFile(
      file,
      { corpusId, title, author, language, documentType, description },
      user.sub,
    );
  }

  @Get(':id/level0')
  getLevel0(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getLevel0Data(id, user.sub);
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
    @Body('aiProvider') aiProvider: AiProvider = 'HUGGINGFACE',
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.initializeAnalisis(id, user.sub, aiProvider);
  }
}

