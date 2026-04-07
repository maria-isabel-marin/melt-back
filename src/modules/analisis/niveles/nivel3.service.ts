import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';
import { AnalisisService } from '../analisis.service';

@Injectable()
export class Nivel3Service {
  constructor(
    private prisma: PrismaService,
    private ai: AiService,
    private analisis: AnalisisService,
  ) {}

  async process(analysisId: string) {
    await this.analisis.setNivelProcesando(analysisId, 3);

    const analysisDoc = await this.prisma.documentAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        conventionalMetaphors: { where: { itemStatus: 'APPROVED' } },
        primaryMetaphors: {
          where: { itemStatus: 'APPROVED' },
          include: { ontologicalMappings: true, epistemicMappings: true },
        },
      },
    });

    const systemPrompt = `Eres un experto en análisis de escenarios metafóricos (Musolff, 2006; Valdivia).
Para cada metáfora convencional aprobada, identifica los escenarios metafóricos que activa.
Un escenario es una mini-narrativa estructurada que la metáfora pone en juego.

Para cada escenario retorna:
- conventionalMetaphorId: ID de la metáfora convencional base
- scenarioName: nombre descriptivo del escenario
- status: DOMINANT | CHALLENGER | EMERGING | PERIPHERAL
- usageValuation: POSITIVE | NEGATIVE | NEUTRAL
- mappingIds: array de IDs de correspondencias relevantes
- socialGroups: array de { socialGroup, legitimizedActions[] }
- narrativeSequence: { act1Beginning, act2Development, act3Resolution, sequenceType: TEMPORAL|CAUSAL }
- evaluativeBias: { positive[], negative[] }
- affects: array de { affectType: FACILITATED|INHIBITED, affectName, description, socialFunction, linguisticMarkers }

Responde ÚNICAMENTE con JSON:
\`\`\`json
{ "scenarios": [ { ...campos } ] }
\`\`\``;

    const input = {
      conventionalMetaphors: analysisDoc?.conventionalMetaphors,
      mappings: analysisDoc?.primaryMetaphors.flatMap((m) => [
        ...m.ontologicalMappings.map((c) => ({ ...c, type: 'ontological' })),
        ...m.epistemicMappings.map((c) => ({ ...c, type: 'epistemic' })),
      ]),
    };

    const result = await this.ai.completeJson<{ scenarios: any[] }>(
      analysisDoc!.aiProvider,
      [{ role: 'user', content: JSON.stringify(input) }],
      systemPrompt,
    );

    await this.prisma.metaphoricalScenario.deleteMany({ where: { analysisId } });

    for (const e of result.scenarios) {
      await this.prisma.metaphoricalScenario.create({
        data: {
          analysisId,
          conventionalMetaphorId: e.conventionalMetaphorId,
          scenarioName: e.scenarioName,
          status: e.status,
          usageValuation: e.usageValuation,
          mappingIds: e.mappingIds ?? [],
          aiGenerated: true,
          socialGroups: {
            create: (e.socialGroups ?? []).map((g: any) => ({
              socialGroup: g.socialGroup,
              legitimizedActions: g.legitimizedActions ?? [],
              aiGenerated: true,
            })),
          },
          narrativeSequence: e.narrativeSequence
            ? {
                create: {
                  act1Beginning: e.narrativeSequence.act1Beginning,
                  act2Development: e.narrativeSequence.act2Development,
                  act3Resolution: e.narrativeSequence.act3Resolution,
                  sequenceType: e.narrativeSequence.sequenceType,
                  aiGenerated: true,
                },
              }
            : undefined,
          evaluativeBias: e.evaluativeBias
            ? {
                create: {
                  positive: e.evaluativeBias.positive ?? [],
                  negative: e.evaluativeBias.negative ?? [],
                  aiGenerated: true,
                },
              }
            : undefined,
          affects: {
            create: (e.affects ?? []).map((a: any) => ({
              affectType: a.affectType,
              affectName: a.affectName,
              description: a.description,
              socialFunction: a.socialFunction,
              linguisticMarkers: a.linguisticMarkers,
              aiGenerated: true,
            })),
          },
        },
      });
    }

    await this.analisis.setNivelPendienteRevision(analysisId, 3);
    return this.getResults(analysisId);
  }

  async getResults(analysisId: string) {
    return this.prisma.metaphoricalScenario.findMany({
      where: { analysisId },
      include: { socialGroups: true, narrativeSequence: true, evaluativeBias: true, affects: true },
    });
  }
}
