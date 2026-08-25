import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiProvider as AiProviderEnum,
  InferenceType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AiJsonResponseException,
  AiService,
} from '../../ai/ai.service';
import type { AiMessage } from '../../ai/ai-provider.interface';
import {
  Level1Approach,
  Level1Config,
  resolveLevel1Config,
} from '../config/level1-config';

type Level0Sentence = {
  id: string;
  page: number | null;
  chapter: string | null;
  text: string;
  originalIndex: number;
};

type SentenceForAnalysis = Level0Sentence & {
  previousText: string;
  nextText: string;
  expandedContext: string;
};

type AiLevel1Response = {
  metaforas?: unknown;
  metaphors?: unknown;
};

type AiMetaphor = Record<string, unknown>;

type NormalizedMetaphor = {
  sentenceId: string;
  page: number | null;
  chapter: string | null;
  context: string;
  expandedContext: string;
  metaphoricalExpression: string;
  focus: string | null;
  focusLemma: string | null;
  focusPartOfSpeech: string | null;
  contextualMeaning: string | null;
  basicMeaning: string | null;
  sourceDomain: string | null;
  targetDomain: string | null;
  conceptualMetaphor: string | null;
  approach: Level1Approach;
  modelName: string;
  modelConfidence: number;
  crossApproachConfidence: number;
  ontologicalMappings: Array<{
    sourceElement: string;
    targetElement: string;
    textualEvidence: string | null;
  }>;
  epistemicMappings: Array<{
    sourceRelation: string;
    targetInference: string;
    inferenceType: InferenceType;
    textualEvidence: string | null;
  }>;
};

type ApproachStats = {
  approach: Level1Approach;
  model: string | null;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
  metaphorCount: number;
};

@Injectable()
export class Nivel1Service {
  private readonly logger = new Logger(Nivel1Service.name);
  private readonly maxRetries: number;
  private readonly rateLimitPauseMs: number;

  constructor(
    private prisma: PrismaService,
    private ai: AiService,
    private configService: ConfigService,
  ) {
    this.maxRetries = this.clampInt(
      this.configService.get('LEVEL1_MAX_RETRIES', '3'),
      3,
      1,
      5,
    );

    this.rateLimitPauseMs = this.clampInt(
      this.configService.get(
        'LEVEL1_RATE_LIMIT_PAUSE_MS',
        '1000',
      ),
      1000,
      0,
      60000,
    );
  }

  async process(analysisId: string) {
    const analysisDoc =
      await this.getAnalysisWithDocument(analysisId);

    if (analysisDoc.level0Status !== 'APPROVED') {
      throw new BadRequestException(
        'Level 0 must be approved before processing Level 1.',
      );
    }

    if (analysisDoc.level1Status === 'PROCESSING') {
      throw new BadRequestException(
        'Level 1 is already processing.',
      );
    }

    if (
      analysisDoc.level2Status === 'PROCESSING' ||
      analysisDoc.level3Status === 'PROCESSING' ||
      analysisDoc.level4Status === 'PROCESSING' ||
      analysisDoc.level5Status === 'PROCESSING'
    ) {
      throw new BadRequestException(
        'Level 1 cannot be reprocessed while a dependent level is processing.',
      );
    }

    const allSentences = this.readLevel0Sentences(
      analysisDoc.document.content,
    );

    if (allSentences.length === 0) {
      throw new BadRequestException(
        'Level 0 does not contain sentences to analyze.',
      );
    }

    const config = resolveLevel1Config(
      analysisDoc.document.corpus.level1Config,
      analysisDoc.document.level1ConfigOverrides,
    );

    const selected = this.selectSentences(
      allSentences,
      config,
    );

    const targets = this.buildExpandedContexts(
      allSentences,
      selected,
    );

    const batches = this.chunk(
      targets,
      config.batchSize,
    );

    if (
      targets.length === 0 ||
      config.approaches.length === 0
    ) {
      throw new BadRequestException(
        'Level 1 requires at least one sentence and one active approach.',
      );
    }

    this.logger.log(
      `[Nivel 1] Inicio | análisis=${analysisId} | ` +
        `oraciones_disponibles=${allSentences.length} | ` +
        `seleccionadas=${targets.length} | ` +
        `lote=${config.batchSize} | ` +
        `enfoques=${config.approaches.join(', ')}`,
    );

    this.logger.log(
      `[Nivel 1] IDs seleccionados: ${targets
        .map((sentence) => sentence.id)
        .join(', ')}`,
    );

    const previousStatus =
      analysisDoc.level1Status;

    await this.prisma.documentAnalysis.update({
      where: {
        id: analysisId,
      },
      data: {
        level1Status: 'PROCESSING',
      },
    });

    const allMetaphors: NormalizedMetaphor[] = [];
    const stats: ApproachStats[] = [];

    try {
      const systemPrompt =
        this.buildSystemPrompt(config);

      for (const approach of config.approaches) {
        const startedAt = Date.now();

        let model: string | null = null;
        let inputTokens = 0;
        let outputTokens = 0;
        let requests = 0;
        let successfulRequests = 0;
        let failedRequests = 0;

        for (
          let i = 0;
          i < batches.length;
          i += 1
        ) {
          const batch = batches[i];

          this.logger.log(
            `[Nivel 1] ${approach} lote ${i + 1}/${batches.length} ` +
              `(${batch.length} oraciones)`,
          );

          const messages =
            this.buildMessages(
              analysisDoc.document.title,
              analysisDoc.document.language,
              batch,
              i + 1,
              batches.length,
              config,
            );

          const result =
            await this.callBatchWithRetry(
              approach as AiProviderEnum,
              messages,
              systemPrompt,
            );

          requests += result.attempts;
          successfulRequests += 1;
          failedRequests += result.failedAttempts;
          model = result.response.model;

          inputTokens += result.totalInputTokens;
          outputTokens += result.totalOutputTokens;

          const normalizedBatch =
            this.normalizeBatchResult(
              result.data,
              batch,
              config,
              approach,
              result.response.model,
            );

          this.logger.log(
            `[Nivel 1] ${approach} lote ${i + 1}/${batches.length}: ` +
              `${normalizedBatch.length} metáfora(s) aceptada(s)`,
          );

          allMetaphors.push(
            ...normalizedBatch,
          );

          const lastApproach =
            approach ===
            config.approaches[
              config.approaches.length - 1
            ];

          const lastBatch =
            i === batches.length - 1;

          if (
            !(lastApproach && lastBatch) &&
            this.rateLimitPauseMs > 0
          ) {
            await this.sleep(
              this.rateLimitPauseMs,
            );
          }
        }

        stats.push({
          approach,
          model,
          requests,
          successfulRequests,
          failedRequests,
          inputTokens,
          outputTokens,
          elapsedMs:
            Date.now() - startedAt,
          metaphorCount: 0,
        });
      }

      this.logger.log(
        `[Nivel 1] Antes de deduplicar: ` +
          `${allMetaphors.length} metáfora(s) aceptada(s).`,
      );

      const metaphors =
        this.deduplicateWithinApproach(
          allMetaphors,
        );

      this.logger.log(
        `[Nivel 1] Después de deduplicar: ` +
          `${metaphors.length} metáfora(s). ` +
          `Eliminadas como duplicadas=` +
          `${allMetaphors.length - metaphors.length}.`,
      );

      this.applyCrossApproachConfidence(
        metaphors,
      );

      for (const item of stats) {
        item.metaphorCount =
          metaphors.filter(
            (metaphor) =>
              metaphor.approach ===
              item.approach,
          ).length;
      }

      const comparisons =
        this.buildApproachComparisons(
          metaphors,
          targets.map(
            (sentence) => sentence.id,
          ),
          config.approaches,
        );

      const metadata = {
        version:
          'N1-MIPVU-MULTI-APPROACH-1',

        level: 'N1',

        completedAt:
          new Date().toISOString(),

        methodology: {
          procedure: 'MIPVU',

          context:
            'previous ||| current ||| next',

          contextSource:
            'full Level 0 sentence sequence',

          fewShotExample: true,

          conventionalMetaphorsIncluded:
            true,

          personificationsIncluded:
            true,

          pureMetonymyExcluded: true,

          nonMetaphoricalIdiomsExcluded:
            true,

          consolidationKey:
            'sentenceId + normalized focus',
        },

        config,

        totalAvailableSentences:
          allSentences.length,

        selectedSentences:
          targets.length,

        selectedSentenceIds:
          targets.map(
            (sentence) => sentence.id,
          ),

        batchSize:
          config.batchSize,

        estimatedRequests:
          batches.length *
          config.approaches.length,

        actualRequests:
          stats.reduce(
            (sum, item) =>
              sum + item.requests,
            0,
          ),

        approachStats: stats,

        comparisons,

        crossApproachDistribution:
          this.buildCrossApproachDistribution(
            metaphors,
          ),

        totalMetaphorRows:
          metaphors.length,
      };

      await this.prisma.$transaction(
        async (tx) => {
          await tx.primaryMetaphor.deleteMany({
            where: {
              analysisId,
            },
          });

          for (const metaphor of metaphors) {
            await tx.primaryMetaphor.create({
              data: {
                analysisId,

                sentenceId:
                  metaphor.sentenceId,

                page:
                  metaphor.page,

                chapter:
                  metaphor.chapter,

                context:
                  metaphor.context,

                expandedContext:
                  metaphor.expandedContext,

                metaphoricalExpression:
                  metaphor.metaphoricalExpression,

                focus:
                  metaphor.focus,

                focusLemma:
                  metaphor.focusLemma,

                focusPartOfSpeech:
                  metaphor.focusPartOfSpeech,

                contextualMeaning:
                  metaphor.contextualMeaning,

                basicMeaning:
                  metaphor.basicMeaning,

                sourceDomain:
                  metaphor.sourceDomain,

                targetDomain:
                  metaphor.targetDomain,

                conceptualMetaphor:
                  metaphor.conceptualMetaphor,

                approach:
                  metaphor.approach,

                modelName:
                  metaphor.modelName,

                modelConfidence:
                  metaphor.modelConfidence,

                crossApproachConfidence:
                  metaphor.crossApproachConfidence,

                aiGenerated: true,

                ontologicalMappings: {
                  create:
                    metaphor.ontologicalMappings.map(
                      (mapping) => ({
                        sourceElement:
                          mapping.sourceElement,

                        targetElement:
                          mapping.targetElement,

                        textualEvidence:
                          mapping.textualEvidence,

                        aiGenerated: true,
                      }),
                    ),
                },

                epistemicMappings: {
                  create:
                    metaphor.epistemicMappings.map(
                      (mapping) => ({
                        sourceRelation:
                          mapping.sourceRelation,

                        targetInference:
                          mapping.targetInference,

                        inferenceType:
                          mapping.inferenceType,

                        textualEvidence:
                          mapping.textualEvidence,

                        aiGenerated: true,
                      }),
                    ),
                },
              },
            });
          }

          const statusData: Prisma.DocumentAnalysisUpdateInput =
            {
              level1Status:
                'PENDING_REVIEW',

              level1Metadata:
                metadata as any,
            };

          if (
            analysisDoc.level2Status !==
            'PENDING'
          ) {
            statusData.level2Status =
              'OUTDATED';
          }

          if (
            analysisDoc.level3Status !==
            'PENDING'
          ) {
            statusData.level3Status =
              'OUTDATED';
          }

          if (
            analysisDoc.level4Status !==
            'PENDING'
          ) {
            statusData.level4Status =
              'OUTDATED';
          }

          if (
            analysisDoc.level5Status !==
            'PENDING'
          ) {
            statusData.level5Status =
              'OUTDATED';
          }

          await tx.documentAnalysis.update({
            where: {
              id: analysisId,
            },

            data: statusData,
          });
        },
      );

      this.logger.log(
        `[Nivel 1] Finalizado | ` +
          `filas_guardadas=${metaphors.length} | ` +
          `requests=${stats.reduce(
            (sum, item) =>
              sum + item.requests,
            0,
          )}`,
      );

      return {
        results:
          await this.getResults(
            analysisId,
          ),

        metadata:
          await this.getMetadata(
            analysisId,
          ),
      };
    } catch (error) {
      await this.prisma.documentAnalysis
        .update({
          where: {
            id: analysisId,
          },

          data: {
            level1Status:
              previousStatus,
          },
        })
        .catch(() => undefined);

      if (error instanceof HttpException) {
        throw error;
      }

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `[Nivel 1] ${message}`,
      );

      throw new InternalServerErrorException(
        `Error in Level 1 processing: ${message}`,
      );
    }
  }

  async getPreview(
    analysisId: string,
  ) {
    const analysisDoc =
      await this.getAnalysisWithDocument(
        analysisId,
      );

    const config =
      resolveLevel1Config(
        analysisDoc.document.corpus
          .level1Config,

        analysisDoc.document
          .level1ConfigOverrides,
      );

    const sentences =
      analysisDoc.document.content
        ? this.readLevel0Sentences(
            analysisDoc.document.content,
          )
        : [];

    const selected =
      this.selectSentences(
        sentences,
        config,
      );

    const batchesPerApproach =
      selected.length
        ? Math.ceil(
            selected.length /
              config.batchSize,
          )
        : 0;

    return {
      analysisId,

      level0Status:
        analysisDoc.level0Status,

      level1Status:
        analysisDoc.level1Status,

      approaches:
        config.approaches,

      totalAvailableSentences:
        sentences.length,

      selectedSentences:
        selected.length,

      selectedSentenceIds:
        selected.map(
          (sentence) => sentence.id,
        ),

      batchSize:
        config.batchSize,

      batchesPerApproach,

      estimatedRequests:
        batchesPerApproach *
        config.approaches.length,

      sentenceSelection:
        config.sentenceSelection,

      output:
        config.output,

      contextPolicy: {
        previousSentence: true,
        currentSentence: true,
        nextSentence: true,
      },

      canProcess:
        analysisDoc.level0Status ===
          'APPROVED' &&
        sentences.length > 0 &&
        config.approaches.length > 0 &&
        analysisDoc.level1Status !==
          'PROCESSING',
    };
  }

  async getMetadata(
    analysisId: string,
  ) {
    const analysis =
      await this.prisma.documentAnalysis.findUnique(
        {
          where: {
            id: analysisId,
          },

          select: {
            id: true,
            level1Status: true,
            level1Metadata: true,
          },
        },
      );

    if (!analysis) {
      throw new NotFoundException(
        `No analysis was found with ID: ${analysisId}`,
      );
    }

    return {
      analysisId:
        analysis.id,

      level1Status:
        analysis.level1Status,

      metadata:
        analysis.level1Metadata,
    };
  }

  async getResults(
    analysisId: string,
  ) {
    return this.prisma.primaryMetaphor.findMany(
      {
        where: {
          analysisId,
        },

        include: {
          ontologicalMappings: true,
          epistemicMappings: true,
        },

        orderBy: [
          {
            page: 'asc',
          },
          {
            sentenceId: 'asc',
          },
          {
            approach: 'asc',
          },
          {
            createdAt: 'asc',
          },
        ],
      },
    );
  }

  private async getAnalysisWithDocument(
    analysisId: string,
  ) {
    const analysis =
      await this.prisma.documentAnalysis.findUnique(
        {
          where: {
            id: analysisId,
          },

          include: {
            document: {
              include: {
                corpus: true,
              },
            },
          },
        },
      );

    if (!analysis) {
      throw new NotFoundException(
        `No analysis was found with ID: ${analysisId}`,
      );
    }

    return analysis;
  }

  private readLevel0Sentences(
    content:
      | Buffer
      | Uint8Array
      | null
      | undefined,
  ): Level0Sentence[] {
    if (!content) {
      return [];
    }

    let raw: any;

    try {
      const buffer =
        Buffer.isBuffer(content)
          ? content
          : Buffer.from(content);

      raw = JSON.parse(
        buffer.toString('utf-8'),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      throw new BadRequestException(
        `Level 0 processed data could not be read: ${message}`,
      );
    }

    if (!Array.isArray(raw?.sentences)) {
      return [];
    }

    return raw.sentences
      .map(
        (
          sentence: any,
          index: number,
        ) => {
          const text =
            this.toText(
              sentence?.oracion_texto ??
                sentence?.text ??
                sentence?.sentence,
              20000,
            );

          if (!text) {
            return null;
          }

          const rawPage =
            sentence?.pagina ??
            sentence?.page;

          const page =
            Number.isFinite(
              Number(rawPage),
            )
              ? Math.trunc(
                  Number(rawPage),
                )
              : null;

          return {
            id:
              this.toText(
                sentence?.ID_oracion ??
                  sentence?.id ??
                  sentence?.sentenceId,
                200,
              ) ??
              `S-${String(
                index + 1,
              ).padStart(6, '0')}`,

            page,

            chapter:
              this.toText(
                sentence?.capitulo ??
                  sentence?.chapter,
                500,
              ),

            text,

            originalIndex:
              index,
          } satisfies Level0Sentence;
        },
      )
      .filter(
        (
          sentence:
            | Level0Sentence
            | null,
        ): sentence is Level0Sentence =>
          sentence !== null,
      );
  }

  private selectSentences(
    sentences: Level0Sentence[],
    config: Level1Config,
  ): Level0Sentence[] {
    const selection =
      config.sentenceSelection;

    if (
      selection.mode === 'ALL' ||
      selection.maxSentences === null ||
      selection.maxSentences >=
        sentences.length
    ) {
      return [...sentences];
    }

    const limit =
      selection.maxSentences;

    if (
      selection.strategy === 'FIRST'
    ) {
      return sentences.slice(
        0,
        limit,
      );
    }

    if (
      selection.strategy ===
      'DISTRIBUTED'
    ) {
      return this.selectDistributed(
        sentences,
        limit,
      );
    }

    if (
      selection.strategy ===
      'BY_CHAPTER'
    ) {
      return this.selectByChapter(
        sentences,
        limit,
      );
    }

    return this.selectRandom(
      sentences,
      limit,
      selection.randomSeed,
    );
  }

  private selectRandom(
    sentences: Level0Sentence[],
    limit: number,
    seed: number,
  ): Level0Sentence[] {
    const indexed =
      sentences.map(
        (sentence, index) => ({
          sentence,
          index,
        }),
      );

    const random =
      this.createSeededRandom(seed);

    for (
      let i = indexed.length - 1;
      i > 0;
      i -= 1
    ) {
      const j =
        Math.floor(
          random() * (i + 1),
        );

      [
        indexed[i],
        indexed[j],
      ] = [
        indexed[j],
        indexed[i],
      ];
    }

    return indexed
      .slice(0, limit)
      .sort(
        (a, b) =>
          a.index - b.index,
      )
      .map(
        (item) =>
          item.sentence,
      );
  }

  private createSeededRandom(
    seed: number,
  ): () => number {
    let state =
      seed >>> 0;

    return () => {
      state +=
        0x6d2b79f5;

      let value = state;

      value = Math.imul(
        value ^
          (value >>> 15),
        value | 1,
      );

      value ^=
        value +
        Math.imul(
          value ^
            (value >>> 7),
          value | 61,
        );

      return (
        ((value ^
          (value >>> 14)) >>>
          0) /
        4294967296
      );
    };
  }

  private selectDistributed(
    sentences: Level0Sentence[],
    limit: number,
  ): Level0Sentence[] {
    if (limit <= 1) {
      return sentences.slice(
        0,
        limit,
      );
    }

    const indexes =
      new Set<number>();

    for (
      let i = 0;
      i < limit;
      i += 1
    ) {
      indexes.add(
        Math.round(
          (i *
            (sentences.length -
              1)) /
            (limit - 1),
        ),
      );
    }

    return [
      ...indexes,
    ]
      .sort(
        (a, b) => a - b,
      )
      .slice(0, limit)
      .map(
        (index) =>
          sentences[index],
      );
  }

  private selectByChapter(
    sentences: Level0Sentence[],
    limit: number,
  ): Level0Sentence[] {
    const groups =
      new Map<
        string,
        Level0Sentence[]
      >();

    for (const sentence of sentences) {
      const key =
        sentence.chapter?.trim() ||
        '__NO_CHAPTER__';

      const group =
        groups.get(key) ?? [];

      group.push(sentence);
      groups.set(
        key,
        group,
      );
    }

    if (groups.size <= 1) {
      return this.selectDistributed(
        sentences,
        limit,
      );
    }

    const values =
      [...groups.values()];

    const selected:
      Level0Sentence[] = [];

    let round = 0;

    while (
      selected.length < limit
    ) {
      let added = false;

      for (const group of values) {
        if (
          selected.length >=
          limit
        ) {
          break;
        }

        if (
          round <
          group.length
        ) {
          selected.push(
            group[round],
          );

          added = true;
        }
      }

      if (!added) {
        break;
      }

      round += 1;
    }

    return selected.sort(
      (a, b) =>
        a.originalIndex -
        b.originalIndex,
    );
  }

  private buildExpandedContexts(
    allSentences:
      Level0Sentence[],
    selected:
      Level0Sentence[],
  ): SentenceForAnalysis[] {
    const indexById =
      new Map<
        string,
        number
      >();

    allSentences.forEach(
      (
        sentence,
        index,
      ) =>
        indexById.set(
          sentence.id,
          index,
        ),
    );

    return selected.map(
      (sentence) => {
        const index =
          indexById.get(
            sentence.id,
          ) ??
          sentence.originalIndex;

        const previousText =
          index > 0
            ? allSentences[
                index - 1
              ].text
            : '';

        const nextText =
          index <
          allSentences.length -
            1
            ? allSentences[
                index + 1
              ].text
            : '';

        return {
          ...sentence,

          previousText,

          nextText,

          expandedContext:
            [
              previousText,
              sentence.text,
              nextText,
            ].join(' ||| '),
        };
      },
    );
  }

  private chunk<T>(
    items: T[],
    size: number,
  ): T[][] {
    const chunks: T[][] =
      [];

    for (
      let i = 0;
      i < items.length;
      i += size
    ) {
      chunks.push(
        items.slice(
          i,
          i + size,
        ),
      );
    }

    return chunks;
  }

  private buildSystemPrompt(
    config: Level1Config,
  ): string {
    const ontologicalRule =
      config.output
        .ontologicalMappings
        ? 'Incluye correspondencias_ontologicas únicamente cuando estén sustentadas por la oración objetivo.'
        : 'Devuelve correspondencias_ontologicas como un arreglo vacío.';

    const epistemicRule =
      config.output
        .epistemicMappings
        ? 'Incluye correspondencias_epistemicas únicamente cuando estén sustentadas por la oración objetivo.'
        : 'Devuelve correspondencias_epistemicas como un arreglo vacío.';

    return `Eres un lingüista cognitivo experto en la Teoría de la Metáfora Conceptual y en el procedimiento MIPVU.

Tu tarea es identificar usos metafóricos en cada oración objetivo siguiendo estrictamente MIPVU.

Procedimiento MIPVU:
1. Lee completa la oración objetivo.
2. Usa la oración anterior y la siguiente únicamente como apoyo contextual.
3. Examina las unidades léxicas relevantes de la oración objetivo, especialmente sustantivos, verbos, adjetivos y adverbios.
4. Para cada posible foco metafórico determina:
   - su significado contextual;
   - su significado más básico, concreto, corporal, espacial, físico o históricamente anterior cuando corresponda.
5. Determina si existe contraste entre ambos significados.
6. Determina si el significado contextual puede comprenderse mediante una comparación, proyección o transferencia desde el significado básico.
7. Solo si se cumplen esos criterios, registra el uso como metafórico.

Criterios generales:
- Las metáforas convencionales también cuentan.
- Las personificaciones cuentan como metáforas.
- No marques expresiones literales.
- No marques metonimias puras.
- No marques modismos sin una base metafórica justificable.
- No identifiques metáforas únicamente porque una expresión sea figurativa o poco frecuente.
- Analiza SOLO la oración objetivo.
- La oración anterior y la siguiente sirven únicamente para desambiguar el significado contextual.
- Nunca devuelvas como metáfora una expresión que aparezca solamente en el contexto anterior o posterior.
- ID_oracion debe coincidir EXACTAMENTE con uno de los ID suministrados.
- No inventes páginas, capítulos, identificadores ni evidencia textual.

Granularidad del análisis:
- foco debe ser la unidad léxica concreta que activa el contraste metafórico.
- foco debe aparecer literalmente en la oración objetivo.
- foco_lemma debe ser el lema de esa unidad léxica.
- expresion_metaforica debe aparecer literalmente en la oración objetivo.
- expresion_metaforica debe ser el SEGMENTO TEXTUAL MÍNIMO necesario para comprender el uso metafórico y debe contener el foco.
- No devuelvas automáticamente la oración completa como expresion_metaforica.
- Si una sola palabra expresa suficientemente el uso metafórico, devuelve esa palabra.
- Si el significado metafórico requiere una construcción de varias palabras, devuelve solamente esa construcción.
- Devuelve la oración completa únicamente en el caso excepcional de que toda la oración sea indispensable para expresar la metáfora.
- Si una misma oración contiene varios focos metafóricos diferentes, devuelve una entrada independiente para cada foco.
- No combines dos focos metafóricos diferentes en una sola entrada.

Dominios y metáfora conceptual:
- dominio_fuente representa el dominio más básico desde el cual se estructura el significado metafórico.
- dominio_meta representa el dominio conceptual que está siendo comprendido.
- metafora_conceptual debe formularse de manera abstracta como DOMINIO META ES DOMINIO FUENTE.
- No inventes una metáfora conceptual si la transferencia no está suficientemente sustentada.

Mapeos:
- ${ontologicalRule}
- ${epistemicRule}
- Las correspondencias deben derivarse del uso metafórico identificado, no de información externa.
- evidencia_textual debe proceder de la oración objetivo.
- tipo_inferencia debe ser exactamente uno de:
  CAUSAL
  TEMPORAL
  CONDICIONAL
  NORMATIVA
  EVALUATIVA

Antes de devolver cada metáfora verifica:
1. ¿ID_oracion pertenece al lote?
2. ¿El foco aparece en la oración objetivo?
3. ¿expresion_metaforica aparece literalmente en la oración objetivo?
4. ¿expresion_metaforica contiene el foco?
5. ¿La expresión es lo más breve posible sin perder el sentido metafórico?
6. ¿Existe realmente contraste entre significado contextual y significado básico?
7. ¿El significado contextual puede comprenderse mediante transferencia desde el básico?

Responde ÚNICAMENTE JSON válido.

Estructura obligatoria:

{
  "metaforas": [
    {
      "ID_oracion": "...",
      "expresion_metaforica": "...",
      "foco": "...",
      "foco_lemma": "...",
      "foco_part_of_speech": "VERB|NOUN|ADJ|ADV",
      "significado_contextual": "...",
      "significado_basico": "...",
      "dominio_fuente": "...",
      "dominio_meta": "...",
      "metafora_conceptual": "...",
      "correspondencias_ontologicas": [
        {
          "elemento_fuente": "...",
          "elemento_meta": "...",
          "evidencia_textual": "..."
        }
      ],
      "correspondencias_epistemicas": [
        {
          "tipo_inferencia": "CAUSAL|TEMPORAL|CONDICIONAL|NORMATIVA|EVALUATIVA",
          "relacion_fuente": "...",
          "inferencia_meta": "...",
          "evidencia_textual": "..."
        }
      ]
    }
  ]
}

Si ninguna oración contiene usos metafóricos que satisfagan MIPVU, responde exactamente:

{"metaforas":[]}`;
  }

  private buildMessages(
    documentTitle: string,
    language: string,
    batch:
      SentenceForAnalysis[],
    batchNumber: number,
    totalBatches: number,
    config: Level1Config,
  ): AiMessage[] {
    const exampleUser =
      `Analiza con MIPVU:\n` +
      `{"ID_oracion":"EXAMPLE-001",` +
      `"contexto_anterior":"",` +
      `"oracion_actual":"El conflicto armado ha dejado heridas profundas en el tejido social colombiano.",` +
      `"contexto_siguiente":""}`;

    const exampleAssistant =
      JSON.stringify({
        metaforas: [
          {
            ID_oracion:
              'EXAMPLE-001',

            expresion_metaforica:
              'heridas profundas en el tejido social',

            foco:
              'heridas',

            foco_lemma:
              'herida',

            foco_part_of_speech:
              'NOUN',

            significado_contextual:
              'daños emocionales o traumas colectivos causados por el conflicto',

            significado_basico:
              'lesión física en el cuerpo',

            dominio_fuente:
              'CUERPO FÍSICO',

            dominio_meta:
              'SOCIEDAD',

            metafora_conceptual:
              'LA SOCIEDAD ES UN CUERPO',

            correspondencias_ontologicas:
              config.output
                .ontologicalMappings
                ? [
                    {
                      elemento_fuente:
                        'herida en el cuerpo',

                      elemento_meta:
                        'trauma colectivo',

                      evidencia_textual:
                        'heridas profundas',
                    },

                    {
                      elemento_fuente:
                        'tejido corporal',

                      elemento_meta:
                        'estructura social',

                      evidencia_textual:
                        'tejido social',
                    },
                  ]
                : [],

            correspondencias_epistemicas:
              config.output
                .epistemicMappings
                ? [
                    {
                      tipo_inferencia:
                        'CAUSAL',

                      relacion_fuente:
                        'Las heridas causan dolor y debilitan el cuerpo',

                      inferencia_meta:
                        'Los traumas causan sufrimiento y debilitan la sociedad',

                      evidencia_textual:
                        'heridas profundas en el tejido social',
                    },
                  ]
                : [],
          },
        ],
      });

    const payload =
      batch.map(
        (sentence) => ({
          ID_oracion:
            sentence.id,

          pagina:
            sentence.page,

          capitulo:
            sentence.chapter,

          contexto_anterior:
            sentence.previousText,

          oracion_actual:
            sentence.text,

          contexto_siguiente:
            sentence.nextText,
        }),
      );

    const userPrompt =
      `Documento: "${documentTitle}"\n` +
      `Idioma: ${language}\n` +
      `Lote: ${batchNumber}/${totalBatches}\n\n` +
      `Analiza TODAS las oraciones objetivo del arreglo. ` +
      `Anterior y siguiente son solo contexto.\n\n` +
      `ORACIONES:\n` +
      JSON.stringify(
        payload,
        null,
        2,
      );

    return [
      {
        role: 'user',
        content: exampleUser,
      },

      {
        role: 'assistant',
        content:
          exampleAssistant,
      },

      {
        role: 'user',
        content: userPrompt,
      },
    ];
  }

  private async callBatchWithRetry(
    provider: AiProviderEnum,
    messages: AiMessage[],
    systemPrompt: string,
  ) {
    let lastError: unknown;
    let attempts = 0;
    let failedAttempts = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (
      let attempt = 1;
      attempt <= this.maxRetries;
      attempt += 1
    ) {
      attempts += 1;

      try {
        const result =
          await this.ai.completeJsonWithMeta<AiLevel1Response>(
            provider,
            messages,
            systemPrompt,
          );

        totalInputTokens +=
          result.response.usage?.inputTokens ?? 0;

        totalOutputTokens +=
          result.response.usage?.outputTokens ?? 0;

        return {
          ...result,
          attempts,
          failedAttempts,
          totalInputTokens,
          totalOutputTokens,
        };
      } catch (error) {
        lastError = error;
        failedAttempts += 1;

        if (error instanceof AiJsonResponseException) {
          totalInputTokens +=
            error.aiResponse.usage?.inputTokens ?? 0;

          totalOutputTokens +=
            error.aiResponse.usage?.outputTokens ?? 0;

          if (error.reason === 'MAX_TOKENS') {
            this.logger.error(
              `[Nivel 1] ${provider} intento ${attempt}: ` +
                `respuesta truncada por límite de tokens. ` +
                `inputTokens=${error.aiResponse.usage?.inputTokens ?? 0} ` +
                `outputTokens=${error.aiResponse.usage?.outputTokens ?? 0}. ` +
                `Reduce el tamaño del lote o aumenta CLAUDE_MAX_TOKENS.`,
            );
          } else {
            this.logger.warn(
              `[Nivel 1] ${provider} intento ${attempt}: ` +
                `respuesta recibida pero JSON inválido. ` +
                `inputTokens=${error.aiResponse.usage?.inputTokens ?? 0} ` +
                `outputTokens=${error.aiResponse.usage?.outputTokens ?? 0}.`,
            );
          }
        }

        if (
          attempt >= this.maxRetries ||
          !this.isRetryableError(error)
        ) {
          throw error;
        }

        const waitMs =
          1000 * 2 ** (attempt - 1);

        this.logger.warn(
          `[Nivel 1] ${provider} intento ${attempt} falló. ` +
            `Reintentando en ${waitMs} ms.`,
        );

        await this.sleep(waitMs);
      }
    }

    throw lastError;
  }

  private isRetryableError(
    error: unknown,
  ): boolean {
    if (error instanceof AiJsonResponseException) {
      // Repetir exactamente la misma petición después de alcanzar max_tokens
      // suele volver a consumir el mismo costo y no resuelve el truncamiento.
      // En ese caso fallamos tras un solo intento para que el usuario pueda
      // reducir batchSize o aumentar CLAUDE_MAX_TOKENS.
      if (error.reason === 'MAX_TOKENS') {
        return false;
      }

      // Un JSON inválido que NO fue truncado puede ser una anomalía transitoria.
      return true;
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();

      return (
        status === 429 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        status >= 500
      );
    }

    return true;
  }

  private normalizeBatchResult(
    result: AiLevel1Response,
    batch:
      SentenceForAnalysis[],
    config: Level1Config,
    approach:
      Level1Approach,
    modelName: string,
  ): NormalizedMetaphor[] {
    const rawMetaphors =
      Array.isArray(
        result?.metaforas,
      )
        ? result.metaforas
        : Array.isArray(
              result?.metaphors,
            )
          ? result.metaphors
          : null;

    if (!rawMetaphors) {
      this.logger.error(
        `[Nivel 1] ${approach}: la respuesta no contiene ` +
          `un arreglo "metaforas" o "metaphors".`,
      );

      throw new InternalServerErrorException(
        'The AI response does not contain a valid metaforas array.',
      );
    }

    this.logger.log(
      `[Nivel 1] ${approach}: ` +
        `el modelo devolvió ${rawMetaphors.length} ` +
        `metáfora(s) candidata(s).`,
    );

    const sentenceMap =
      new Map<
        string,
        SentenceForAnalysis
      >(
        batch.map(
          (sentence) => [
            sentence.id,
            sentence,
          ],
        ),
      );

    const normalized:
      NormalizedMetaphor[] = [];

    let rejectedInvalidObject =
      0;

    let rejectedMissingSentenceId =
      0;

    let rejectedUnknownSentenceId =
      0;

    let rejectedMissingExpression =
      0;

    let rejectedExpressionMismatch =
      0;

    for (
      let index = 0;
      index <
      rawMetaphors.length;
      index += 1
    ) {
      const value =
        rawMetaphors[index];

      if (
        !value ||
        typeof value !==
          'object' ||
        Array.isArray(value)
      ) {
        rejectedInvalidObject +=
          1;

        this.logger.warn(
          `[Nivel 1] ${approach} candidata ${index + 1}: ` +
            `descartada porque no es un objeto válido.`,
        );

        continue;
      }

      const raw =
        value as AiMetaphor;

      const sentenceId =
        this.toText(
          raw.ID_oracion ??
            raw.sentenceId,
          200,
        );

      if (!sentenceId) {
        rejectedMissingSentenceId +=
          1;

        this.logger.warn(
          `[Nivel 1] ${approach} candidata ${index + 1}: ` +
            `descartada porque no contiene ID_oracion.`,
        );

        continue;
      }

      const sentence =
        sentenceMap.get(
          sentenceId,
        );

      if (!sentence) {
        rejectedUnknownSentenceId +=
          1;

        this.logger.warn(
          `[Nivel 1] ${approach} candidata ${index + 1}: ` +
            `descartada porque ID_oracion="${sentenceId}" ` +
            `no pertenece al lote actual.`,
        );

        continue;
      }

      const expression =
        this.toText(
          raw.expresion_metaforica ??
            raw.metaphoricalExpression,
          500,
        );

      if (!expression) {
        rejectedMissingExpression +=
          1;

        this.logger.warn(
          `[Nivel 1] ${approach} candidata ${index + 1} ` +
            `(${sentenceId}): descartada porque no contiene ` +
            `expresion_metaforica.`,
        );

        continue;
      }

      if (
        !this.expressionExistsInSentence(
          expression,
          sentence.text,
        )
      ) {
        rejectedExpressionMismatch +=
          1;

        this.logger.warn(
          `[Nivel 1] ${approach} candidata ${index + 1} ` +
            `(${sentenceId}): descartada porque la expresión ` +
            `"${this.logText(expression)}" no aparece en la oración objetivo.`,
        );

        this.logger.warn(
          `[Nivel 1] ${approach} oración objetivo (${sentenceId}): ` +
            `"${this.logText(sentence.text)}"`,
        );

        continue;
      }

      const normalizedMetaphor: NormalizedMetaphor =
        {
          sentenceId,

          page:
            sentence.page,

          chapter:
            sentence.chapter,

          context:
            sentence.text,

          expandedContext:
            sentence.expandedContext,

          metaphoricalExpression:
            expression,

          focus:
            this.toText(
              raw.foco ??
                raw.focus,
              100,
            ),

          focusLemma:
            this.toText(
              raw.foco_lemma ??
                raw.focusLemma,
              100,
            ),

          focusPartOfSpeech:
            this.toText(
              raw.foco_part_of_speech ??
                raw.focusPartOfSpeech,
              100,
            ),

          contextualMeaning:
            this.toText(
              raw.significado_contextual ??
                raw.contextualMeaning,
              500,
            ),

          basicMeaning:
            this.toText(
              raw.significado_basico ??
                raw.basicMeaning,
              500,
            ),

          sourceDomain:
            this.toText(
              raw.dominio_fuente ??
                raw.sourceDomain,
              200,
            ),

          targetDomain:
            this.toText(
              raw.dominio_meta ??
                raw.targetDomain,
              200,
            ),

          conceptualMetaphor:
            this.toText(
              raw.metafora_conceptual ??
                raw.conceptualMetaphor,
              500,
            ),

          approach,

          modelName,

          modelConfidence:
            1.0,

          crossApproachConfidence:
            1,

          ontologicalMappings:
            config.output
              .ontologicalMappings
              ? this.normalizeOntologicalMappings(
                  raw.correspondencias_ontologicas ??
                    raw.ontologicalMappings,
                )
              : [],

          epistemicMappings:
            config.output
              .epistemicMappings
              ? this.normalizeEpistemicMappings(
                  raw.correspondencias_epistemicas ??
                    raw.epistemicMappings,
                )
              : [],
        };

      normalized.push(
        normalizedMetaphor,
      );

      this.logger.log(
        `[Nivel 1] ${approach} candidata ${index + 1} ` +
          `(${sentenceId}): ACEPTADA | ` +
          `expresión="${this.logText(
            expression,
            120,
          )}" | ` +
          `foco="${this.logText(
            normalizedMetaphor.focus ??
              '',
            80,
          )}"`,
      );
    }

    const rejectedTotal =
      rejectedInvalidObject +
      rejectedMissingSentenceId +
      rejectedUnknownSentenceId +
      rejectedMissingExpression +
      rejectedExpressionMismatch;

    this.logger.log(
      `[Nivel 1] ${approach} resumen de validación: ` +
        `devueltas=${rawMetaphors.length}, ` +
        `aceptadas=${normalized.length}, ` +
        `descartadas=${rejectedTotal}`,
    );

    if (
      rejectedTotal > 0
    ) {
      this.logger.warn(
        `[Nivel 1] ${approach} descartes: ` +
          `objeto_invalido=${rejectedInvalidObject}, ` +
          `sin_ID=${rejectedMissingSentenceId}, ` +
          `ID_fuera_del_lote=${rejectedUnknownSentenceId}, ` +
          `sin_expresion=${rejectedMissingExpression}, ` +
          `expresion_no_encontrada=${rejectedExpressionMismatch}`,
      );
    }

    return normalized;
  }

  private normalizeOntologicalMappings(
    value: unknown,
  ) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((mapping: any) => {
        const sourceElement =
          this.toText(
            mapping?.elemento_fuente ??
              mapping?.sourceElement,
            200,
          );

        const targetElement =
          this.toText(
            mapping?.elemento_meta ??
              mapping?.targetElement,
            200,
          );

        if (
          !sourceElement ||
          !targetElement
        ) {
          return null;
        }

        return {
          sourceElement,

          targetElement,

          textualEvidence:
            this.toText(
              mapping?.evidencia_textual ??
                mapping?.textualEvidence,
              2000,
            ),
        };
      })
      .filter(
        Boolean,
      ) as Array<{
      sourceElement: string;
      targetElement: string;
      textualEvidence:
        | string
        | null;
    }>;
  }

  private normalizeEpistemicMappings(
    value: unknown,
  ) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((mapping: any) => {
        const sourceRelation =
          this.toText(
            mapping?.relacion_fuente ??
              mapping?.sourceRelation,
            300,
          );

        const targetInference =
          this.toText(
            mapping?.inferencia_meta ??
              mapping?.targetInference,
            300,
          );

        if (
          !sourceRelation ||
          !targetInference
        ) {
          return null;
        }

        return {
          sourceRelation,

          targetInference,

          inferenceType:
            this.normalizeInferenceType(
              mapping?.tipo_inferencia ??
                mapping?.inferenceType,
            ),

          textualEvidence:
            this.toText(
              mapping?.evidencia_textual ??
                mapping?.textualEvidence,
              2000,
            ),
        };
      })
      .filter(
        Boolean,
      ) as Array<{
      sourceRelation: string;
      targetInference: string;
      inferenceType:
        InferenceType;
      textualEvidence:
        | string
        | null;
    }>;
  }

  private deduplicateWithinApproach(
    metaphors:
      NormalizedMetaphor[],
  ): NormalizedMetaphor[] {
    const seen =
      new Set<string>();

    return metaphors.filter(
      (metaphor) => {
        const focus =
          this.normalizeForMatch(
            metaphor.focus ??
              metaphor.focusLemma ??
              metaphor.metaphoricalExpression,
          );

        const key =
          `${metaphor.approach}::` +
          `${metaphor.sentenceId}::` +
          `${focus}`;

        if (seen.has(key)) {
          this.logger.warn(
            `[Nivel 1] Duplicado eliminado | ` +
              `enfoque=${metaphor.approach} | ` +
              `oracion=${metaphor.sentenceId} | ` +
              `foco="${this.logText(
                metaphor.focus ??
                  metaphor.focusLemma ??
                  metaphor.metaphoricalExpression,
                100,
              )}"`,
          );

          return false;
        }

        seen.add(key);

        return true;
      },
    );
  }

  private applyCrossApproachConfidence(
    metaphors:
      NormalizedMetaphor[],
  ) {
    const approachesByKey =
      new Map<
        string,
        Set<Level1Approach>
      >();

    for (const metaphor of metaphors) {
      const key =
        this.crossKey(
          metaphor,
        );

      const set =
        approachesByKey.get(
          key,
        ) ??
        new Set<Level1Approach>();

      set.add(
        metaphor.approach,
      );

      approachesByKey.set(
        key,
        set,
      );
    }

    for (const metaphor of metaphors) {
      metaphor.crossApproachConfidence =
        approachesByKey.get(
          this.crossKey(
            metaphor,
          ),
        )?.size ?? 1;
    }
  }

  private crossKey(
    metaphor:
      NormalizedMetaphor,
  ): string {
    const focus =
      this.normalizeForMatch(
        metaphor.focus ??
          metaphor.focusLemma ??
          metaphor.metaphoricalExpression,
      );

    return (
      `${metaphor.sentenceId}::` +
      `${focus}`
    );
  }

  private buildCrossApproachDistribution(
    metaphors:
      NormalizedMetaphor[],
  ): Record<string, number> {
    const result:
      Record<string, number> =
      {};

    for (const metaphor of metaphors) {
      const key =
        String(
          metaphor.crossApproachConfidence,
        );

      result[key] =
        (result[key] ??
          0) + 1;
    }

    return result;
  }

  private buildApproachComparisons(
    metaphors:
      NormalizedMetaphor[],
    sentenceIds: string[],
    approaches:
      Level1Approach[],
  ) {
    const rows:
      Array<
        Record<
          string,
          unknown
        >
      > = [];

    for (
      let i = 0;
      i < approaches.length;
      i += 1
    ) {
      for (
        let j = i + 1;
        j < approaches.length;
        j += 1
      ) {
        const approachA =
          approaches[i];

        const approachB =
          approaches[j];

        const a =
          metaphors.filter(
            (metaphor) =>
              metaphor.approach ===
              approachA,
          );

        const b =
          metaphors.filter(
            (metaphor) =>
              metaphor.approach ===
              approachB,
          );

        const detectedA =
          new Set(
            a.map(
              (metaphor) =>
                metaphor.sentenceId,
            ),
          );

        const detectedB =
          new Set(
            b.map(
              (metaphor) =>
                metaphor.sentenceId,
            ),
          );

        const vectorA =
          sentenceIds.map(
            (id) =>
              detectedA.has(id)
                ? 1
                : 0,
          );

        const vectorB =
          sentenceIds.map(
            (id) =>
              detectedB.has(id)
                ? 1
                : 0,
          );

        rows.push({
          approachA,

          approachB,

          kappaSentence:
            this.cohenKappa(
              vectorA,
              vectorB,
            ),

          sharedSourceDomains:
            this.countSharedValues(
              a.map(
                (metaphor) =>
                  metaphor.sourceDomain,
              ),
              b.map(
                (metaphor) =>
                  metaphor.sourceDomain,
              ),
            ),

          sharedConceptualMetaphors:
            this.countSharedValues(
              a.map(
                (metaphor) =>
                  metaphor.conceptualMetaphor,
              ),
              b.map(
                (metaphor) =>
                  metaphor.conceptualMetaphor,
              ),
            ),
        });
      }
    }

    return rows;
  }

  private cohenKappa(
    a: number[],
    b: number[],
  ): number | null {
    if (
      !a.length ||
      a.length !== b.length
    ) {
      return null;
    }

    let agreements = 0;
    let aPositive = 0;
    let bPositive = 0;

    for (
      let i = 0;
      i < a.length;
      i += 1
    ) {
      if (a[i] === b[i]) {
        agreements += 1;
      }

      if (a[i] === 1) {
        aPositive += 1;
      }

      if (b[i] === 1) {
        bPositive += 1;
      }
    }

    const n = a.length;

    const observed =
      agreements / n;

    const pA =
      aPositive / n;

    const pB =
      bPositive / n;

    const expected =
      pA * pB +
      (1 - pA) *
        (1 - pB);

    if (
      Math.abs(
        1 - expected,
      ) < 1e-12
    ) {
      return null;
    }

    return Number(
      (
        (observed -
          expected) /
        (1 - expected)
      ).toFixed(6),
    );
  }

  private countSharedValues(
    a:
      Array<
        string | null
      >,
    b:
      Array<
        string | null
      >,
  ): number {
    const setA =
      new Set(
        a
          .map((value) =>
            value
              ? this.normalizeForMatch(
                  value,
                )
              : '',
          )
          .filter(Boolean),
      );

    const setB =
      new Set(
        b
          .map((value) =>
            value
              ? this.normalizeForMatch(
                  value,
                )
              : '',
          )
          .filter(Boolean),
      );

    return [
      ...setA,
    ].filter(
      (value) =>
        setB.has(value),
    ).length;
  }

  private normalizeInferenceType(
    value: unknown,
  ): InferenceType {
    const normalized =
      this.normalizeForMatch(
        String(
          value ?? '',
        ),
      )
        .replace(
          /\s+/g,
          '_',
        )
        .toUpperCase();

    const map:
      Record<
        string,
        InferenceType
      > = {
      CAUSAL:
        'CAUSAL',

      TEMPORAL:
        'TEMPORAL',

      CONDICIONAL:
        'CONDITIONAL',

      CONDITIONAL:
        'CONDITIONAL',

      NORMATIVA:
        'NORMATIVE',

      NORMATIVE:
        'NORMATIVE',

      EVALUATIVA:
        'EVALUATIVE',

      EVALUATIVE:
        'EVALUATIVE',
    };

    return (
      map[normalized] ??
      'EVALUATIVE'
    );
  }

  private expressionExistsInSentence(
    expression: string,
    sentence: string,
  ) {
    const normalizedExpression =
      this.normalizeForMatch(
        expression,
      );

    const normalizedSentence =
      this.normalizeForMatch(
        sentence,
      );

    return (
      normalizedExpression.length >
        0 &&
      normalizedSentence.includes(
        normalizedExpression,
      )
    );
  }

  private logText(
    value: string,
    maxLength = 250,
  ): string {
    const text =
      String(value ?? '')
        .replace(
          /\s+/g,
          ' ',
        )
        .trim();

    if (
      text.length <=
      maxLength
    ) {
      return text;
    }

    return `${text.slice(
      0,
      maxLength,
    )}…`;
  }

  private normalizeForMatch(
    value: string,
  ): string {
    return value
      .normalize('NFD')
      .replace(
        /[\u0300-\u036f]/g,
        '',
      )
      .toLowerCase()
      .replace(
        /[^\p{L}\p{N}]+/gu,
        ' ',
      )
      .replace(
        /\s+/g,
        ' ',
      )
      .trim();
  }

  private toText(
    value: unknown,
    maxLength: number,
  ): string | null {
    if (
      value === null ||
      value === undefined
    ) {
      return null;
    }

    const text =
      String(value)
        .replace(
          /\s+/g,
          ' ',
        )
        .trim();

    return text
      ? text.slice(
          0,
          maxLength,
        )
      : null;
  }

  private clampInt(
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const numberValue =
      Number(value);

    if (
      !Number.isFinite(
        numberValue,
      )
    ) {
      return fallback;
    }

    return Math.min(
      maximum,
      Math.max(
        minimum,
        Math.round(
          numberValue,
        ),
      ),
    );
  }

  private sleep(
    ms: number,
  ) {
    return new Promise<void>(
      (resolve) =>
        setTimeout(
          resolve,
          ms,
        ),
    );
  }
}
