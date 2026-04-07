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

  async process(analisisId: string) {
    await this.analisis.setNivelProcesando(analisisId, 2);

    const analisisDoc = await this.prisma.analisisDocumento.findUnique({
      where: { id: analisisId },
      include: { metaforasPrimarias: true },
    });

    const metaforas = analisisDoc?.metaforasPrimarias
      .filter((m) => m.itemStatus === 'APROBADO')
      .map((m) => ({
        id: m.id,
        metaforaConceptual: m.metaforaConceptual,
        dominioFuente: m.dominioFuente,
        dominioMeta: m.dominioMeta,
      }));

    const systemPrompt = `Eres un experto en lingüística cognitiva. Tu tarea es identificar metáforas convencionales
a partir de un conjunto de metáforas conceptuales primarias, aplicando dos enfoques:

1. FRECUENCIA: agrupa metáforas que son instancias exactas o casi exactas de la misma metáfora conceptual.
   Si supera el umbral de frecuencia (≥3), es convencional. La metáfora convencional es la forma más común.
2. CLUSTER_TEMATICO: agrupa metáforas por familia conceptual (mismo dominio fuente), elige la metáfora
   estructurante principal. Si el cluster tiene ≥3 metáforas, es convencional.

Para cada metáfora convencional retorna:
- metaforaConceptual: forma canónica A ES B
- dominioFuente / dominioMeta
- enfoque: FRECUENCIA | CLUSTER_TEMATICO
- frecuenciaAbsoluta: conteo de metáforas primarias que la instancian
- robustez: ALTA (≥5) | MODERADA (3-4) | DEBIL (<3)
- contextoUso: descripción breve del contexto de uso
- metaforasPrimariasIds: array de IDs de metáforas primarias que la componen

Responde ÚNICAMENTE con JSON:
\`\`\`json
{ "metaforasConvencionales": [ { ...campos, "metaforasPrimariasIds": ["id1","id2"] }, ... ] }
\`\`\``;

    const result = await this.ai.completeJson<{ metaforasConvencionales: any[] }>(
      analisisDoc!.aiProvider,
      [{ role: 'user', content: JSON.stringify({ metaforas }) }],
      systemPrompt,
    );

    await this.prisma.metaforaConvencional.deleteMany({ where: { analisisId } });

    for (const mc of result.metaforasConvencionales) {
      const created = await this.prisma.metaforaConvencional.create({
        data: {
          analisisId,
          metaforaConceptual: mc.metaforaConceptual,
          dominioFuente: mc.dominioFuente,
          dominioMeta: mc.dominioMeta,
          enfoque: mc.enfoque,
          frecuenciaAbsoluta: mc.frecuenciaAbsoluta ?? 0,
          robustez: mc.robustez,
          contextoUso: mc.contextoUso,
          aiGenerated: true,
        },
      });

      // Link M:N with primary metaphors
      if (mc.metaforasPrimariasIds?.length) {
        await this.prisma.metaforaPrimariaConvencional.createMany({
          data: mc.metaforasPrimariasIds.map((mpId: string) => ({
            metaforaConvencionalId: created.id,
            metaforaPrimariaId: mpId,
          })),
          skipDuplicates: true,
        });
      }
    }

    await this.analisis.setNivelPendienteRevision(analisisId, 2);
    return this.getResults(analisisId);
  }

  async getResults(analisisId: string) {
    return this.prisma.metaforaConvencional.findMany({
      where: { analisisId },
      include: { metaforasPrimarias: { include: { metaforaPrimaria: true } } },
      orderBy: { frecuenciaAbsoluta: 'desc' },
    });
  }
}
