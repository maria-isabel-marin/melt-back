import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Language, DocumentType } from '@prisma/client';
import { IngestionService } from './ingestion.service';
import { PipelineProcessorService } from './pipeline-processor.service';
import { PipelineProgressDto, PipelineResultDto } from './dto/pipeline.dto';
import * as fs from 'fs';
import * as path from 'path';

@Controller('documentos/pipeline')
@UseGuards(JwtAuthGuard)
export class PipelineController {
  constructor(
    private ingestionService: IngestionService,
    private pipelineProcessor: PipelineProcessorService,
    private prisma: PrismaService
  ) {}

  /**
   * POST /documentos/pipeline/upload
   * Sube archivo e inicia pipeline (paso 1)
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAndStart(
    @UploadedFile() file: Express.Multer.File,
    @Body('corpusId') corpusId: string,
    @Body('title') title: string,
    @CurrentUser() user: JwtPayload,
    @Body('author') author?: string,
    @Body('language') language?: Language,
  ): Promise<any> { // <- cambiamos el tipo de retorno, ver más abajo
    if (!file) throw new BadRequestException('No file uploaded');
    if (!corpusId) throw new BadRequestException('corpusId requerido');
    if (!title) throw new BadRequestException('title requerido');

    // Verificar acceso al corpus
    const corpus = await this.prisma.userCorpus.findUnique({
      where: { userId_corpusId: { userId: user.sub, corpusId } },
    });
    if (!corpus) throw new NotFoundException('Corpus no encontrado o sin acceso');

    try {
    // Llamar directamente al servicio de ingesta
    return await this.ingestionService.ingestFile(
      file,
      {
        corpusId,
        title,
        author,
        language: language || 'SPANISH',
      },
      user.sub,
    );
    } catch (error: any) {
      throw new InternalServerErrorException(
        `Error iniciando pipeline: ${error.message}`
      );
    }
  }

  /**
   * GET /documentos/pipeline/:pipelineId/progress
   * Obtiene estado actual de la pipeline
   */
  @Get(':pipelineId/progress')
  async getProgress(@Param('pipelineId') pipelineId: string): Promise<PipelineProgressDto> {
    // Implementar obteniendo del servicio de orquestación
    // Por ahora retornar estructura básica
    return {
      pipelineId,
      currentStep: 1,
      status: 'in_progress',
      progress: {
        1: { status: 'completed', progress: 100 },
        2: { status: 'in_progress', progress: 50 },
        3: { status: 'pending', progress: 0 },
        4: { status: 'pending', progress: 0 },
        5: { status: 'pending', progress: 0 },
        6: { status: 'pending', progress: 0 },
      },
      metadata: {
        filename: 'documento.pdf',
        title: 'Mi Documento',
        language: 'SPANISH',
        uploadedAt: new Date(),
      },
    };
  }

  /**
   * POST /documentos/pipeline/:pipelineId/next
   * Ejecuta el siguiente paso de la pipeline
   */
  @Post(':pipelineId/next')
  async executeNextStep(@Param('pipelineId') pipelineId: string): Promise<any> {
    // Implementar lógica para ejecutar siguiente paso
    return { message: 'Step iniciado' };
  }

  /**
   * GET /documentos/pipeline/:pipelineId/result
   * Obtiene resultado final cuando esté completo
   */
  @Get(':pipelineId/result')
  async getResult(
    @Param('pipelineId') pipelineId: string,
    @CurrentUser() user: JwtPayload
  ): Promise<PipelineResultDto> {
    // Implementar obteniendo del servicio
    return {
      pipelineId,
      documentId: 'doc-123',
      status: 'completed',
    };
  }

  /**
   * DELETE /documentos/pipeline/:pipelineId
   * Cancela una pipeline
   */
  @Delete(':pipelineId')
  async cancelPipeline(@Param('pipelineId') pipelineId: string): Promise<any> {
    return { message: `Pipeline ${pipelineId} cancelada` };
  }

  /**
   * GET /documentos/pipeline/active
   * Lista pipelines activas (debug)
   */
  @Get()
  async listActivePipelines(): Promise<any> {
    return { message: 'Pipelines activas' };
  }
}
