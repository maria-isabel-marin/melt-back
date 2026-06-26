import { Module } from '@nestjs/common';
import { DocumentosController } from './documentos.controller';
import { DocumentosService } from './documentos.service';

import { IngestionService } from './ingestion.service';

@Module({
  controllers: [DocumentosController],
  providers: [DocumentosService, IngestionService],
  exports: [DocumentosService, IngestionService],
})
export class DocumentosModule {}
