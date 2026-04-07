import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AnalisisController } from './analisis.controller';
import { AnalisisService } from './analisis.service';
import { Nivel1Service } from './niveles/nivel1.service';
import { Nivel2Service } from './niveles/nivel2.service';
import { Nivel3Service } from './niveles/nivel3.service';
import { Nivel4Service } from './niveles/nivel4.service';
import { Nivel5Service } from './niveles/nivel5.service';

@Module({
  imports: [AiModule],
  controllers: [AnalisisController],
  providers: [AnalisisService, Nivel1Service, Nivel2Service, Nivel3Service, Nivel4Service, Nivel5Service],
  exports: [AnalisisService],
})
export class AnalisisModule {}
