import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';
import { AnalisisService } from '../analisis.service';

@Injectable()
export class Nivel5Service {
  constructor(
    private prisma: PrismaService,
    private ai: AiService,
    private analisis: AnalisisService,
  ) {}

  async process(analisisId: string) {
    await this.analisis.setNivelProcesando(analisisId, 5);

    const analisisDoc = await this.prisma.analisisDocumento.findUnique({
      where: { id: analisisId },
      include: {
        regimenes: {
          where: { itemStatus: 'APROBADO' },
          include: { ejeValorativo: true, escenarios: { include: { escenario: { include: { secuenciaNarrativa: true, sesgoEvaluativo: true } } } }, metaforasDerivadas: true },
          orderBy: { frecuenciaAgregada: 'desc' },
        },
        documento: true,
      },
    });

    const systemPrompt = `Eres un experto en narrativas culturales y análisis crítico del discurso.
A partir del régimen dominante (mayor frecuencia) y los demás regímenes aprobados, sintetiza la narrativa cultural
del discurso analizado.

La narrativa cultural es una "matriz simbólica codificada moral y estéticamente que orienta el comportamiento
y significa la relación imaginaria entre el individuo y sus condiciones materiales de existencia
en un contexto histórico-espacial dado" (Valdivia).

Retorna:
- regimenDominanteId: ID del régimen dominante
- nombre: nombre de la narrativa cultural (breve, evocador)
- descripcion: descripción de 3-5 oraciones de la narrativa cultural
- distribucionTextual: array de citas o referencias textuales que evidencian la narrativa

Responde ÚNICAMENTE con JSON:
\`\`\`json
{ "narrativa": { "regimenDominanteId": "...", "nombre": "...", "descripcion": "...", "distribucionTextual": [] } }
\`\`\``;

    const result = await this.ai.completeJson<{ narrativa: any }>(
      analisisDoc!.aiProvider,
      [{ role: 'user', content: JSON.stringify({ regimenes: analisisDoc?.regimenes, documento: analisisDoc?.documento.titulo }) }],
      systemPrompt,
    );

    await this.prisma.narrativaCultural.deleteMany({ where: { analisisId } });

    const narrativa = result.narrativa;
    await this.prisma.narrativaCultural.create({
      data: {
        analisisId,
        regimenId: narrativa.regimenDominanteId,
        nombre: narrativa.nombre,
        descripcion: narrativa.descripcion,
        distribucionTextual: narrativa.distribucionTextual ?? [],
        aiGenerated: true,
      },
    });

    await this.analisis.setNivelPendienteRevision(analisisId, 5);
    return this.prisma.narrativaCultural.findUnique({ where: { analisisId } });
  }

  async getResults(analisisId: string) {
    return this.prisma.narrativaCultural.findUnique({
      where: { analisisId },
      include: { regimen: { include: { ejeValorativo: true } } },
    });
  }
}
