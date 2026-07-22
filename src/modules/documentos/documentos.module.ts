import { Module } from '@nestjs/common';
import { DocumentosController } from './documentos.controller';
import { DocumentosService } from './documentos.service';
import { Level0ProgressService } from './level0-progress.service';
import { IngestionService } from './ingestion.service';

@Module({
  controllers: [DocumentosController],
  providers: [DocumentosService, IngestionService, Level0ProgressService],
    exports: [DocumentosService, IngestionService, Level0ProgressService],
})
export class DocumentosModule {}
