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

  async process(analysisId: string) {
    await this.analisis.setNivelProcesando(analysisId, 1);

    const analysisDoc = await this.prisma.documentAnalysis.findUnique({
      where: { id: analysisId },
      include: { document: true },
    });

    const systemPrompt = `Eres un experto en análisis de metáforas conceptuales aplicando el procedimiento MIPVU
(Metaphor Identification Procedure VU) y la versión mejorada de Coll-Florit & Climent (2019).
Tu tarea es identificar expresiones metafóricas en el texto y para cada una extraer:
- metaphoricalExpression: la expresión literal del texto
- page: número de página aproximado
- context: oración o párrafo donde aparece
- focus: palabra clave metafórica
- focusLemma: forma lema del foco
- focusPartOfSpeech: categoría gramatical (NOUN, VERB, ADJ, ADV)
- contextualMeaning: significado en este contexto
- basicMeaning: significado más concreto/primario
- sourceDomain: dominio conceptual de origen
- targetDomain: dominio conceptual de destino
- conceptualMetaphor: forma canónica A ES B
- ontologicalMappings: array de {sourceElement, targetElement, textualEvidence}
- epistemicMappings: array de {sourceRelation, targetInference, inferenceType}
  (inferenceType: CAUSAL | TEMPORAL | CONDITIONAL | NORMATIVE | EVALUATIVE)

Responde ÚNICAMENTE con un JSON válido en el formato:
\`\`\`json
{ "metaphors": [ { ...campos }, ... ] }
\`\`\``;

    const content = analysisDoc?.document.fileUrl
      ? `Analiza el siguiente documento: ${analysisDoc.document.title}\n[El contenido será extraído del archivo]`
      : `Analiza el documento: ${analysisDoc?.document.title}`;

    const result = await this.ai.completeJson<{ metaphors: any[] }>(
      analysisDoc!.aiProvider,
      [{ role: 'user', content }],
      systemPrompt,
    );

    await this.prisma.primaryMetaphor.deleteMany({ where: { analysisId } });

    for (const m of result.metaphors) {
      await this.prisma.primaryMetaphor.create({
        data: {
          analysisId,
          metaphoricalExpression: m.metaphoricalExpression,
          page: m.page,
          context: m.context,
          focus: m.focus,
          focusLemma: m.focusLemma,
          focusPartOfSpeech: m.focusPartOfSpeech,
          contextualMeaning: m.contextualMeaning,
          basicMeaning: m.basicMeaning,
          sourceDomain: m.sourceDomain,
          targetDomain: m.targetDomain,
          conceptualMetaphor: m.conceptualMetaphor,
          aiGenerated: true,
          ontologicalMappings: {
            create: (m.ontologicalMappings ?? []).map((c: any) => ({
              sourceElement: c.sourceElement,
              targetElement: c.targetElement,
              textualEvidence: c.textualEvidence,
              aiGenerated: true,
            })),
          },
          epistemicMappings: {
            create: (m.epistemicMappings ?? []).map((c: any) => ({
              sourceRelation: c.sourceRelation,
              targetInference: c.targetInference,
              inferenceType: c.inferenceType,
              textualEvidence: c.textualEvidence,
              aiGenerated: true,
            })),
          },
        },
      });
    }

    await this.analisis.setNivelPendienteRevision(analysisId, 1);
    return this.prisma.primaryMetaphor.findMany({
      where: { analysisId },
      include: { ontologicalMappings: true, epistemicMappings: true },
    });
  }

  async getResults(analysisId: string) {
    return this.prisma.primaryMetaphor.findMany({
      where: { analysisId },
      include: { ontologicalMappings: true, epistemicMappings: true },
      orderBy: [{ page: 'asc' }, { createdAt: 'asc' }],
    });
  }
}
