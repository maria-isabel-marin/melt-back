import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';
import { AnalisisService } from '../analisis.service';

@Injectable()
export class Nivel4Service {
  constructor(
    private prisma: PrismaService,
    private ai: AiService,
    private analisis: AnalisisService,
  ) {}

  async process(analysisId: string) {
    await this.analisis.setNivelProcesando(analysisId, 4);

    const analysisDoc = await this.prisma.documentAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        scenarios: {
          where: { itemStatus: 'APPROVED' },
          include: { evaluativeBias: true, socialGroups: true },
        },
      },
    });

    const systemPrompt = `Eres un experto en regímenes de metáforas (Charteris-Black, Valdivia).
Agrupa los escenarios aprobados en regímenes coherentes basándote en los sesgos evaluativos compartidos
(qué es positivo/negativo en cada escenario). Un régimen es un sistema ideológico coherente.

Para cada régimen retorna:
- regimeName: nombre descriptivo del régimen
- aggregateFrequency: suma de frecuencias de las metáforas convencionales que lo componen
- scenarioIds: array de IDs de escenarios que agrupa
- metaphors: array de metáforas conceptuales principales del régimen
- derivedMetaphors: array de metáforas derivadas por transitividad (ej. PROGRESS IS UP)
- valueAxis: { axisName, positivePolarity[], negativePolarity[], evidence }

Responde ÚNICAMENTE con JSON:
\`\`\`json
{ "regimes": [ { ...campos } ] }
\`\`\``;

    const result = await this.ai.completeJson<{ regimes: any[] }>(
      analysisDoc!.aiProvider,
      [{ role: 'user', content: JSON.stringify({ scenarios: analysisDoc?.scenarios }) }],
      systemPrompt,
    );

    await this.prisma.metaphorRegime.deleteMany({ where: { analysisId } });

    for (const r of result.regimes) {
      const regime = await this.prisma.metaphorRegime.create({
        data: {
          analysisId,
          regimeName: r.regimeName,
          aggregateFrequency: r.aggregateFrequency ?? 0,
          metaphors: r.metaphors ?? [],
          aiGenerated: true,
          derivedMetaphors: {
            create: (r.derivedMetaphors ?? []).map((md: string) => ({
              derivedMetaphor: md,
              aiGenerated: true,
            })),
          },
          valueAxis: r.valueAxis
            ? {
                create: {
                  axisName: r.valueAxis.axisName,
                  positivePolarity: r.valueAxis.positivePolarity ?? [],
                  negativePolarity: r.valueAxis.negativePolarity ?? [],
                  evidence: r.valueAxis.evidence,
                  aiGenerated: true,
                },
              }
            : undefined,
        },
      });

      if (r.scenarioIds?.length) {
        await this.prisma.scenarioRegime.createMany({
          data: r.scenarioIds.map((sid: string) => ({ regimeId: regime.id, scenarioId: sid })),
          skipDuplicates: true,
        });
      }
    }

    await this.analisis.setNivelPendienteRevision(analysisId, 4);
    return this.getResults(analysisId);
  }

  async getResults(analysisId: string) {
    return this.prisma.metaphorRegime.findMany({
      where: { analysisId },
      include: {
        scenarios: { include: { scenario: true } },
        derivedMetaphors: true,
        valueAxis: true,
      },
      orderBy: { aggregateFrequency: 'desc' },
    });
  }
}
