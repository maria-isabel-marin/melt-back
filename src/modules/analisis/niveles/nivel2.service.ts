import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';
import { AnalisisService } from '../analisis.service';

@Injectable()
export class Nivel2Service {
  constructor(
    private prisma: PrismaService,
    private ai: AiService,
    private analisis: AnalisisService,
  ) {}

  async process(analysisId: string) {
    await this.analisis.setNivelProcesando(analysisId, 2);

    const analysisDoc = await this.prisma.documentAnalysis.findUnique({
      where: { id: analysisId },
      include: { primaryMetaphors: true },
    });

    const metaphors = analysisDoc?.primaryMetaphors
      .filter((m) => m.itemStatus === 'APPROVED')
      .map((m) => ({
        id: m.id,
        conceptualMetaphor: m.conceptualMetaphor,
        sourceDomain: m.sourceDomain,
        targetDomain: m.targetDomain,
      }));

    const systemPrompt = `Eres un experto en lingüística cognitiva. Tu tarea es identificar metáforas convencionales
a partir de un conjunto de metáforas conceptuales primarias, aplicando dos enfoques:

1. FREQUENCY: agrupa metáforas que son instancias exactas o casi exactas de la misma metáfora conceptual.
   Si supera el umbral de frecuencia (≥3), es convencional.
2. THEMATIC_CLUSTER: agrupa metáforas por familia conceptual (mismo dominio fuente), elige la metáfora
   estructurante principal. Si el cluster tiene ≥3 metáforas, es convencional.

Para cada metáfora convencional retorna:
- conceptualMetaphor: forma canónica A ES B
- sourceDomain / targetDomain
- approach: FREQUENCY | THEMATIC_CLUSTER
- absoluteFrequency: conteo de metáforas primarias que la instancian
- robustness: HIGH (≥5) | MODERATE (3-4) | WEAK (<3)
- usageContext: descripción breve del contexto de uso
- primaryMetaphorIds: array de IDs de metáforas primarias que la componen

Responde ÚNICAMENTE con JSON:
\`\`\`json
{ "conventionalMetaphors": [ { ...campos, "primaryMetaphorIds": ["id1","id2"] }, ... ] }
\`\`\``;

    const result = await this.ai.completeJson<{ conventionalMetaphors: any[] }>(
      analysisDoc!.aiProvider,
      [{ role: 'user', content: JSON.stringify({ metaphors }) }],
      systemPrompt,
    );

    await this.prisma.conventionalMetaphor.deleteMany({ where: { analysisId } });

    for (const mc of result.conventionalMetaphors) {
      const created = await this.prisma.conventionalMetaphor.create({
        data: {
          analysisId,
          conceptualMetaphor: mc.conceptualMetaphor,
          sourceDomain: mc.sourceDomain,
          targetDomain: mc.targetDomain,
          approach: mc.approach,
          absoluteFrequency: mc.absoluteFrequency ?? 0,
          robustness: mc.robustness,
          usageContext: mc.usageContext,
          aiGenerated: true,
        },
      });

      if (mc.primaryMetaphorIds?.length) {
        await this.prisma.primaryMetaphorConventional.createMany({
          data: mc.primaryMetaphorIds.map((mpId: string) => ({
            conventionalMetaphorId: created.id,
            primaryMetaphorId: mpId,
          })),
          skipDuplicates: true,
        });
      }
    }

    await this.analisis.setNivelPendienteRevision(analysisId, 2);
    return this.getResults(analysisId);
  }

  async getResults(analysisId: string) {
    return this.prisma.conventionalMetaphor.findMany({
      where: { analysisId },
      include: { primaryMetaphors: { include: { primaryMetaphor: true } } },
      orderBy: { absoluteFrequency: 'desc' },
    });
  }
}
