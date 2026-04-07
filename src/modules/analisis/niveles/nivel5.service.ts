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

  async process(analysisId: string) {
    await this.analisis.setNivelProcesando(analysisId, 5);

    const analysisDoc = await this.prisma.documentAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        regimes: {
          where: { itemStatus: 'APPROVED' },
          include: {
            valueAxis: true,
            scenarios: {
              include: {
                scenario: {
                  include: { narrativeSequence: true, evaluativeBias: true },
                },
              },
            },
            derivedMetaphors: true,
          },
          orderBy: { aggregateFrequency: 'desc' },
        },
        document: true,
      },
    });

    const systemPrompt = `Eres un experto en narrativas culturales y análisis crítico del discurso.
A partir del régimen dominante (mayor frecuencia) y los demás regímenes aprobados, sintetiza la narrativa cultural
del discurso analizado.

La narrativa cultural es una "matriz simbólica codificada moral y estéticamente que orienta el comportamiento
y significa la relación imaginaria entre el individuo y sus condiciones materiales de existencia
en un contexto histórico-espacial dado" (Valdivia).

Retorna:
- dominantRegimeId: ID del régimen dominante
- name: nombre de la narrativa cultural (breve, evocador)
- description: descripción de 3-5 oraciones de la narrativa cultural
- textualDistribution: array de citas o referencias textuales que evidencian la narrativa

Responde ÚNICAMENTE con JSON:
\`\`\`json
{ "narrative": { "dominantRegimeId": "...", "name": "...", "description": "...", "textualDistribution": [] } }
\`\`\``;

    const result = await this.ai.completeJson<{ narrative: any }>(
      analysisDoc!.aiProvider,
      [
        {
          role: 'user',
          content: JSON.stringify({
            regimes: analysisDoc?.regimes,
            document: analysisDoc?.document.title,
          }),
        },
      ],
      systemPrompt,
    );

    await this.prisma.culturalNarrative.deleteMany({ where: { analysisId } });

    const narrative = result.narrative;
    await this.prisma.culturalNarrative.create({
      data: {
        analysisId,
        regimeId: narrative.dominantRegimeId,
        name: narrative.name,
        description: narrative.description,
        textualDistribution: narrative.textualDistribution ?? [],
        aiGenerated: true,
      },
    });

    await this.analisis.setNivelPendienteRevision(analysisId, 5);
    return this.prisma.culturalNarrative.findUnique({ where: { analysisId } });
  }

  async getResults(analysisId: string) {
    return this.prisma.culturalNarrative.findUnique({
      where: { analysisId },
      include: { regime: { include: { valueAxis: true } } },
    });
  }
}
