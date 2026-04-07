import { Module } from '@nestjs/common';
import { CorpusController } from './corpus.controller';
import { CorpusService } from './corpus.service';

@Module({
  controllers: [CorpusController],
  providers: [CorpusService],
  exports: [CorpusService],
})
export class CorpusModule {}
