import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { CorpusModule } from './modules/corpus/corpus.module';
import { DocumentosModule } from './modules/documentos/documentos.module';
import { AnalisisModule } from './modules/analisis/analisis.module';
import { AiModule } from './modules/ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    AiModule,
    CorpusModule,
    DocumentosModule,
    AnalisisModule,
  ],
})
export class AppModule {}
