import { Controller, Get, Post, Patch, Param, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AnalisisService } from './analisis.service';
import { Nivel1Service } from './niveles/nivel1.service';
import { Nivel2Service } from './niveles/nivel2.service';
import { Nivel3Service } from './niveles/nivel3.service';
import { Nivel4Service } from './niveles/nivel4.service';
import { Nivel5Service } from './niveles/nivel5.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ItemStatus } from '@prisma/client';

@Controller('analisis')
@UseGuards(JwtAuthGuard)
export class AnalisisController {
  constructor(
    private analisis: AnalisisService,
    private nivel1: Nivel1Service,
    private nivel2: Nivel2Service,
    private nivel3: Nivel3Service,
    private nivel4: Nivel4Service,
    private nivel5: Nivel5Service,
  ) {}

  // ── Estado general del análisis ──────────────────────────────────────────
  @Get(':id')
  getAnalisis(@Param('id') id: string) {
    return this.analisis.getAnalisis(id);
  }

  @Get(':id/full')
  getFullAnalisis(@Param('id') id: string) {
    return this.analisis.getFullAnalisis(id);
  }

  // ── Procesamiento por nivel ──────────────────────────────────────────────
  @Post(':id/nivel/1/process')
  processNivel1(@Param('id') id: string) {
    return this.nivel1.process(id);
  }

  @Post(':id/nivel/2/process')
  processNivel2(@Param('id') id: string) {
    return this.nivel2.process(id);
  }

  @Post(':id/nivel/3/process')
  processNivel3(@Param('id') id: string) {
    return this.nivel3.process(id);
  }

  @Post(':id/nivel/4/process')
  processNivel4(@Param('id') id: string) {
    return this.nivel4.process(id);
  }

  @Post(':id/nivel/5/process')
  processNivel5(@Param('id') id: string) {
    return this.nivel5.process(id);
  }

  // ── Resultados por nivel ─────────────────────────────────────────────────
  @Get(':id/nivel/1')
  getNivel1(@Param('id') id: string) {
    return this.nivel1.getResults(id);
  }

  @Get(':id/nivel/2')
  getNivel2(@Param('id') id: string) {
    return this.nivel2.getResults(id);
  }

  @Get(':id/nivel/3')
  getNivel3(@Param('id') id: string) {
    return this.nivel3.getResults(id);
  }

  @Get(':id/nivel/4')
  getNivel4(@Param('id') id: string) {
    return this.nivel4.getResults(id);
  }

  @Get(':id/nivel/5')
  getNivel5(@Param('id') id: string) {
    return this.nivel5.getResults(id);
  }

  // ── Aprobación ────────────────────────────────────────────────────────────
  @Post(':id/nivel/:nivel/approve')
  approveNivel(@Param('id') id: string, @Param('nivel', ParseIntPipe) nivel: number) {
    return this.analisis.approveNivel(id, nivel);
  }

  @Post(':id/nivel/:nivel/approve-all')
  approveAll(@Param('id') id: string, @Param('nivel', ParseIntPipe) nivel: number) {
    return this.analisis.approveAllItems(id, nivel);
  }

  // ── Estado de ítems individuales ─────────────────────────────────────────
  @Patch('items/:model/:itemId/status')
  updateItemStatus(
    @Param('model') model: any,
    @Param('itemId') itemId: string,
    @Body('status') status: ItemStatus,
    @Body('analystNote') analystNote?: string,
  ) {
    return this.analisis.updateItemStatus(model, itemId, status, analystNote);
  }
}
