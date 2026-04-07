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

  async process(analisisId: string) {
    await this.analisis.setNivelProcesando(analisisId, 4);

    const analisisDoc = await this.prisma.analisisDocumento.findUnique({
      where: { id: analisisId },
      include: {
        escenarios: {
          where: { itemStatus: 'APROBADO' },
          include: { sesgoEvaluativo: true, gruposSociales: true },
        },
      },
    });

    const systemPrompt = `Eres un experto en regímenes de metáforas (Charteris-Black, Valdivia).
Agrupa los escenarios aprobados en regímenes coherentes basándote en los sesgos evaluativos compartidos
(qué es positivo/negativo en cada escenario). Un régimen es un sistema ideológico coherente.

Para cada régimen retorna:
- nombreRegimen: nombre descriptivo del régimen
- frecuenciaAgregada: suma de frecuencias de las metáforas convencionales que lo componen
- escenarioIds: array de IDs de escenarios que agrupa
- metaforas: array de metáforas conceptuales principales del régimen
- metaforasDerivadas: array de metáforas derivadas por transitividad (ej. PROGRESS IS UP)
- ejeValorativo: { nombreEje, poloPositivo[], poloNegativo[], evidencia }

Responde ÚNICAMENTE con JSON:
\`\`\`json
{ "regimenes": [ { ...campos } ] }
\`\`\``;

    const result = await this.ai.completeJson<{ regimenes: any[] }>(
      analisisDoc!.aiProvider,
      [{ role: 'user', content: JSON.stringify({ escenarios: analisisDoc?.escenarios }) }],
      systemPrompt,
    );

    await this.prisma.regimenDeMetaforas.deleteMany({ where: { analisisId } });

    for (const r of result.regimenes) {
      const regimen = await this.prisma.regimenDeMetaforas.create({
        data: {
          analisisId,
          nombreRegimen: r.nombreRegimen,
          frecuenciaAgregada: r.frecuenciaAgregada ?? 0,
          metaforas: r.metaforas ?? [],
          aiGenerated: true,
          metaforasDerivadas: {
            create: (r.metaforasDerivadas ?? []).map((md: string) => ({ metaforaDerivada: md, aiGenerated: true })),
          },
          ejeValorativo: r.ejeValorativo ? {
            create: {
              nombreEje: r.ejeValorativo.nombreEje,
              poloPositivo: r.ejeValorativo.poloPositivo ?? [],
              poloNegativo: r.ejeValorativo.poloNegativo ?? [],
              evidencia: r.ejeValorativo.evidencia,
              aiGenerated: true,
            },
          } : undefined,
        },
      });

      if (r.escenarioIds?.length) {
        await this.prisma.escenarioRegimen.createMany({
          data: r.escenarioIds.map((eid: string) => ({ regimenId: regimen.id, escenarioId: eid })),
          skipDuplicates: true,
        });
      }
    }

    await this.analisis.setNivelPendienteRevision(analisisId, 4);
    return this.getResults(analisisId);
  }

  async getResults(analisisId: string) {
    return this.prisma.regimenDeMetaforas.findMany({
      where: { analisisId },
      include: { escenarios: { include: { escenario: true } }, metaforasDerivadas: true, ejeValorativo: true },
      orderBy: { frecuenciaAgregada: 'desc' },
    });
  }
}
