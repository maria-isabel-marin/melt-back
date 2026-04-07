import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';
import { AnalisisService } from '../analisis.service';

@Injectable()
export class Nivel1Service {
  constructor(
    private prisma: PrismaService,
    private ai: AiService,
    private analisis: AnalisisService,
  ) {}

  async process(analisisId: string) {
    await this.analisis.setNivelProcesando(analisisId, 1);

    const analisisDoc = await this.prisma.analisisDocumento.findUnique({
      where: { id: analisisId },
      include: { documento: true },
    });

    const systemPrompt = `Eres un experto en análisis de metáforas conceptuales aplicando el procedimiento MIPVU
(Metaphor Identification Procedure VU) y la versión mejorada de Coll-Florit & Climent (2019).
Tu tarea es identificar expresiones metafóricas en el texto y para cada una extraer:
- expresionMetaforica: la expresión literal del texto
- pagina: número de página aproximado
- contexto: oración o párrafo donde aparece
- foco: palabra clave metafórica
- focoLemma: forma lema del foco
- focoPartOfSpeech: categoría gramatical (NOUN, VERB, ADJ, ADV)
- significadoContextual: significado en este contexto
- significadoBasico: significado más concreto/primario
- dominioFuente: dominio conceptual de origen
- dominioMeta: dominio conceptual de destino
- metaforaConceptual: forma canónica A ES B
- correspondenciasOntologicas: array de {elementoFuente, elementoMeta, evidenciaTextual}
- correspondenciasEpistemicas: array de {relacionFuente, inferenciaMeta, tipoInferencia}
  (tipoInferencia: CAUSAL | TEMPORAL | CONDICIONAL | NORMATIVA | EVALUATIVA)

Responde ÚNICAMENTE con un JSON válido en el formato:
\`\`\`json
{ "metaforas": [ { ...campos }, ... ] }
\`\`\``;

    const content = analisisDoc?.documento.fileUrl
      ? `Analiza el siguiente documento: ${analisisDoc.documento.titulo}\n[El contenido será extraído del archivo]`
      : `Analiza el documento: ${analisisDoc?.documento.titulo}`;

    const result = await this.ai.completeJson<{ metaforas: any[] }>(
      analisisDoc!.aiProvider,
      [{ role: 'user', content }],
      systemPrompt,
    );

    // Clear previous results for this nivel
    await this.prisma.metaforaPrimaria.deleteMany({ where: { analisisId } });

    // Persist AI results
    for (const m of result.metaforas) {
      await this.prisma.metaforaPrimaria.create({
        data: {
          analisisId,
          expresionMetaforica: m.expresionMetaforica,
          pagina: m.pagina,
          contexto: m.contexto,
          foco: m.foco,
          focoLemma: m.focoLemma,
          focoPartOfSpeech: m.focoPartOfSpeech,
          significadoContextual: m.significadoContextual,
          significadoBasico: m.significadoBasico,
          dominioFuente: m.dominioFuente,
          dominioMeta: m.dominioMeta,
          metaforaConceptual: m.metaforaConceptual,
          aiGenerated: true,
          correspondenciasOntologicas: {
            create: (m.correspondenciasOntologicas ?? []).map((c: any) => ({
              elementoFuente: c.elementoFuente,
              elementoMeta: c.elementoMeta,
              evidenciaTextual: c.evidenciaTextual,
              aiGenerated: true,
            })),
          },
          correspondenciasEpistemicas: {
            create: (m.correspondenciasEpistemicas ?? []).map((c: any) => ({
              relacionFuente: c.relacionFuente,
              inferenciaMeta: c.inferenciaMeta,
              tipoInferencia: c.tipoInferencia,
              evidenciaTextual: c.evidenciaTextual,
              aiGenerated: true,
            })),
          },
        },
      });
    }

    await this.analisis.setNivelPendienteRevision(analisisId, 1);
    return this.prisma.metaforaPrimaria.findMany({
      where: { analisisId },
      include: { correspondenciasOntologicas: true, correspondenciasEpistemicas: true },
    });
  }

  async getResults(analisisId: string) {
    return this.prisma.metaforaPrimaria.findMany({
      where: { analisisId },
      include: { correspondenciasOntologicas: true, correspondenciasEpistemicas: true },
      orderBy: [{ pagina: 'asc' }, { createdAt: 'asc' }],
    });
  }
}
