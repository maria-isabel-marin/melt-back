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

  async process(analisisId: string) {
    await this.analisis.setNivelProcesando(analisisId, 3);

    const analisisDoc = await this.prisma.analisisDocumento.findUnique({
      where: { id: analisisId },
      include: {
        metaforasConvencionales: { where: { itemStatus: 'APROBADO' } },
        metaforasPrimarias: {
          where: { itemStatus: 'APROBADO' },
          include: { correspondenciasOntologicas: true, correspondenciasEpistemicas: true },
        },
      },
    });

    const systemPrompt = `Eres un experto en análisis de escenarios metafóricos (Musolff, 2006; Valdivia).
Para cada metáfora convencional aprobada, identifica los escenarios metafóricos que activa.
Un escenario es una mini-narrativa estructurada que la metáfora pone en juego.

Para cada escenario retorna:
- metaforaConvencionalId: ID de la metáfora convencional base
- nombreEscenario: nombre descriptivo del escenario
- estatus: DOMINANTE | CHALLENGER | EMERGENTE | PERIFERICO
- valoracionUso: POSITIVO | NEGATIVO | NEUTRO
- idCorrespondencias: array de IDs de correspondencias relevantes
- gruposSociales: array de { grupoSocial, accionesLegitimadas[] }
- secuenciaNarrativa: { acto1Inicio, acto2Desarrollo, acto3Desenlace, tipo: TEMPORAL|CAUSAL }
- sesgoEvaluativo: { positivo[], negativo[] }
- afectos: array de { tipoAfecto: FACILITADO|INHIBIDO, nombreAfecto, descripcion, funcionSocial, marcadoresLinguisticos }

Responde ÚNICAMENTE con JSON:
\`\`\`json
{ "escenarios": [ { ...campos } ] }
\`\`\``;

    const input = {
      metaforasConvencionales: analisisDoc?.metaforasConvencionales,
      correspondencias: analisisDoc?.metaforasPrimarias.flatMap((m) => [
        ...m.correspondenciasOntologicas.map((c) => ({ ...c, tipo: 'ontologica' })),
        ...m.correspondenciasEpistemicas.map((c) => ({ ...c, tipo: 'epistemica' })),
      ]),
    };

    const result = await this.ai.completeJson<{ escenarios: any[] }>(
      analisisDoc!.aiProvider,
      [{ role: 'user', content: JSON.stringify(input) }],
      systemPrompt,
    );

    await this.prisma.escenarioMetaforico.deleteMany({ where: { analisisId } });

    for (const e of result.escenarios) {
      await this.prisma.escenarioMetaforico.create({
        data: {
          analisisId,
          metaforaConvencionalId: e.metaforaConvencionalId,
          nombreEscenario: e.nombreEscenario,
          estatus: e.estatus,
          valoracionUso: e.valoracionUso,
          idCorrespondencias: e.idCorrespondencias ?? [],
          aiGenerated: true,
          gruposSociales: { create: (e.gruposSociales ?? []).map((g: any) => ({ grupoSocial: g.grupoSocial, accionesLegitimadas: g.accionesLegitimadas ?? [], aiGenerated: true })) },
          secuenciaNarrativa: e.secuenciaNarrativa ? {
            create: {
              acto1Inicio: e.secuenciaNarrativa.acto1Inicio,
              acto2Desarrollo: e.secuenciaNarrativa.acto2Desarrollo,
              acto3Desenlace: e.secuenciaNarrativa.acto3Desenlace,
              tipo: e.secuenciaNarrativa.tipo,
              aiGenerated: true,
            },
          } : undefined,
          sesgoEvaluativo: e.sesgoEvaluativo ? {
            create: { positivo: e.sesgoEvaluativo.positivo ?? [], negativo: e.sesgoEvaluativo.negativo ?? [], aiGenerated: true },
          } : undefined,
          afectos: { create: (e.afectos ?? []).map((a: any) => ({ tipoAfecto: a.tipoAfecto, nombreAfecto: a.nombreAfecto, descripcion: a.descripcion, funcionSocial: a.funcionSocial, marcadoresLinguisticos: a.marcadoresLinguisticos, aiGenerated: true })) },
        },
      });
    }

    await this.analisis.setNivelPendienteRevision(analisisId, 3);
    return this.getResults(analisisId);
  }

  async getResults(analisisId: string) {
    return this.prisma.escenarioMetaforico.findMany({
      where: { analisisId },
      include: { gruposSociales: true, secuenciaNarrativa: true, sesgoEvaluativo: true, afectos: true },
    });
  }
}
