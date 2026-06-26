import { Injectable, NotFoundException, HttpException, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';
import { AnalisisService } from '../analisis.service';

@Injectable()
export class Nivel1Service {
  private readonly logger = new Logger(Nivel1Service.name);

  constructor(
    private prisma: PrismaService,
    private ai: AiService,
    private analisis: AnalisisService,
  ) {}

  async process(analysisId: string) {
    const analysisDoc = await this.prisma.documentAnalysis.findUnique({
      where: { id: analysisId },
      include: { document: true },
    });

    if (!analysisDoc) {
      throw new NotFoundException(`No se encontró el análisis con ID: ${analysisId}`);
    }

    // Cambiar estado a PROCESSING
    await this.analisis.setNivelProcesando(analysisId, 1);

    try {
      const systemPrompt = `Eres un experto en análisis de metáforas conceptuales aplicando el procedimiento MIPVU.
Identifica expresiones metafóricas en el texto y extrae sus propiedades.
Responde ÚNICAMENTE con un JSON válido en el formato:
{ "metaphors": [ { "metaphoricalExpression": "...", "page": 1, "context": "...", "focus": "...", "focusLemma": "...", "focusPartOfSpeech": "NOUN", "contextualMeaning": "...", "basicMeaning": "...", "sourceDomain": "...", "targetDomain": "...", "conceptualMetaphor": "A ES B", "ontologicalMappings": [], "epistemicMappings": [] } ] }`;

      const content = `Analiza el documento titulado: "${analysisDoc.document.title}". 
      Contenido/Descripción: ${analysisDoc.document.description || 'Sin descripción disponible'}.`;

      this.logger.log(`[Nivel 1] Solicitando procesamiento a IA (${analysisDoc.aiProvider}) para análisis ${analysisId}`);
      
      const result = await this.ai.completeJson<{ metaphors: any[] }>(
        analysisDoc.aiProvider,
        [{ role: 'user', content }],
        systemPrompt,
      );

      if (!result || !Array.isArray(result.metaphors)) {
        throw new InternalServerErrorException('La respuesta de la IA no contiene un array de metáforas válido.');
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.primaryMetaphor.deleteMany({ where: { analysisId } });

        for (const m of result.metaphors) {
          await tx.primaryMetaphor.create({
            data: {
              analysisId,
              metaphoricalExpression: m.metaphoricalExpression || 'N/A',
              page: m.page || 0,
              context: m.context || '',
              focus: m.focus || '',
              focusLemma: m.focusLemma || '',
              focusPartOfSpeech: m.focusPartOfSpeech || 'NOUN',
              contextualMeaning: m.contextualMeaning || '',
              basicMeaning: m.basicMeaning || '',
              sourceDomain: m.sourceDomain || '',
              targetDomain: m.targetDomain || '',
              conceptualMetaphor: m.conceptualMetaphor || '',
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
                  inferenceType: c.inferenceType || 'EVALUATIVE',
                  textualEvidence: c.textualEvidence,
                  aiGenerated: true,
                })),
              },
            },
          });
        }
      });

      await this.analisis.setNivelPendienteRevision(analysisId, 1);
      return this.getResults(analysisId);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Nivel 1] Error: ${errorMessage}`);
      
      // Revertir estado para permitir reintento
      await this.prisma.documentAnalysis.update({
        where: { id: analysisId },
        data: { level1Status: 'PENDING' }
      }).catch(err => {
        const revertMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(`No se pudo revertir el estado: ${revertMessage}`);
      });

      // Si el error ya es una excepción HTTP (429, 401, 400), la lanzamos directamente
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new InternalServerErrorException(`Error en el procesamiento de Nivel 1: ${errorMessage}`);
    }
  }

  async getResults(analysisId: string) {
    return this.prisma.primaryMetaphor.findMany({
      where: { analysisId },
      include: { ontologicalMappings: true, epistemicMappings: true },
      orderBy: [{ page: 'asc' }, { createdAt: 'asc' }],
    });
  }
}