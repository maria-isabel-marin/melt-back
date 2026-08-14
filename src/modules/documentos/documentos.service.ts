import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import { AiProvider, Prisma } from '@prisma/client';
import {
  normalizeDocumentLevel0Overrides,
  resolveLevel0Config,
} from '../../common/level0-config';

@Injectable()
export class DocumentosService {
  constructor(private prisma: PrismaService) {}

  async findAllByCorpus(corpusId: string, userId: string) {
    await this.assertCorpusAccess(corpusId, userId);

    return this.prisma.document.findMany({
      where: { corpusId },
      include: {
        analysis: {
          select: {
            id: true,
            aiProvider: true,
            level0Status: true,
            level1Status: true,
            level2Status: true,
            level3Status: true,
            level4Status: true,
            level5Status: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: {
        corpus: { include: { users: { where: { userId } } } },
        analysis: true,
      },
    });

    if (!doc || doc.corpus.users.length === 0) {
      throw new NotFoundException('Document not found');
    }

    return doc;
  }

  async create(dto: CreateDocumentoDto, userId: string) {
    await this.assertCorpusAccess(dto.corpusId, userId);

    return this.prisma.document.create({
      data: {
        corpusId: dto.corpusId,
        title: dto.title,
        description: dto.description,
        author: dto.author,
        documentType: dto.documentType,
        language: dto.language,
        pageCount: dto.pageCount,
        fileUrl: dto.fileUrl,
      },
    });
  }

  async remove(id: string, userId: string) {
    const doc = await this.findOne(id, userId);
    return this.prisma.document.delete({ where: { id: doc.id } });
  }

  async initializeAnalisis(documentId: string, userId: string, aiProvider: AiProvider) {
    const doc = await this.findOne(documentId, userId);

    if (doc.analysis) {
      return this.prisma.documentAnalysis.update({
        where: { documentId },
        data: { aiProvider },
      });
    }

    return this.prisma.documentAnalysis.create({
      data: {
        documentId,
        aiProvider,
      },
    });
  }

  async getLevel0Config(documentId: string, userId: string) {
    const doc = await this.findOne(documentId, userId);

    const overrides =
      doc.level0ConfigOverrides === null
        ? null
        : normalizeDocumentLevel0Overrides(doc.level0ConfigOverrides);

    return {
      corpusConfig: resolveLevel0Config(doc.corpus.level0Config, null),
      overrides,
      effectiveConfig: resolveLevel0Config(
        doc.corpus.level0Config,
        doc.level0ConfigOverrides,
      ),
      source: doc.level0ConfigOverrides === null ? 'CORPUS' : 'DOCUMENT',
    };
  }

  async updateLevel0Config(
    documentId: string,
    userId: string,
    overrides: unknown,
  ) {
    const doc = await this.findOne(documentId, userId);

    if (doc.analysis?.level0Status === 'PROCESSING') {
      throw new BadRequestException(
        'Level 0 configuration cannot be changed while this document is processing.',
      );
    }

    const normalized =
      overrides === null
        ? null
        : normalizeDocumentLevel0Overrides(overrides);

    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        level0ConfigOverrides:
          normalized === null ? Prisma.DbNull : (normalized as any),
      },
    });

    await this.invalidateDocumentAnalysis(documentId);

    return this.getLevel0Config(documentId, userId);
  }

  private async invalidateDocumentAnalysis(documentId: string) {
    const analysis = await this.prisma.documentAnalysis.findUnique({
      where: { documentId },
    });

    if (!analysis) return;

    const data: Prisma.DocumentAnalysisUpdateInput = {};

    if (analysis.level0Status !== 'PENDING') data.level0Status = 'OUTDATED';
    if (analysis.level1Status !== 'PENDING') data.level1Status = 'OUTDATED';
    if (analysis.level2Status !== 'PENDING') data.level2Status = 'OUTDATED';
    if (analysis.level3Status !== 'PENDING') data.level3Status = 'OUTDATED';
    if (analysis.level4Status !== 'PENDING') data.level4Status = 'OUTDATED';
    if (analysis.level5Status !== 'PENDING') data.level5Status = 'OUTDATED';

    if (Object.keys(data).length === 0) return;

    await this.prisma.documentAnalysis.update({
      where: { documentId },
      data,
    });
  }

  private getRawPages(raw: any): Array<any> {
    return raw.pages || raw.paginas || raw.df_pages || [];
  }

  private normalizeChapterTitle(value: any): string | null {
    if (typeof value !== 'string') return null

    const clean = value
      .replace(/\s+/g, ' ')
      .replace(/^\d+\.\s*/, '')
      .trim()

    if (!clean) return null
    if (clean.length < 3) return null
    if (clean.length > 180) return null

    return clean
  }

  private getChapterPageRows(raw: any): Array<{ page: number; chapter: string }> {
    const fromPages = this.getRawPages(raw).map((row: any) => ({
      page: row.pagina ?? row.page ?? null,
      chapter: this.normalizeChapterTitle(row.capitulo ?? row.chapter ?? row.chapter_title),
    }))

    const fromSentences = (raw.sentences ?? []).map((row: any) => ({
      page: row.pagina ?? row.page ?? null,
      chapter: this.normalizeChapterTitle(row.capitulo ?? row.chapter),
    }))

    const merged = [...fromPages, ...fromSentences].filter(
      (row): row is { page: number; chapter: string } =>
        typeof row.page === 'number' && Number.isFinite(row.page) && !!row.chapter
    )

    const groupedByPage = new Map<number, Map<string, number>>()

    for (const row of merged) {
      if (!groupedByPage.has(row.page)) {
        groupedByPage.set(row.page, new Map<string, number>())
      }

      const pageMap = groupedByPage.get(row.page)!
      pageMap.set(row.chapter, (pageMap.get(row.chapter) ?? 0) + 1)
    }

    const resolvedRows: Array<{ page: number; chapter: string }> = []

    for (const [page, chapterCounts] of groupedByPage.entries()) {
      const winner = [...chapterCounts.entries()].sort((a, b) => b[1] - a[1])[0]
      if (winner) {
        resolvedRows.push({ page, chapter: winner[0] })
      }
    }

    return resolvedRows.sort((a, b) => a.page - b.page)
  }

  private safeParseJsonArray(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private normalizeEntities(value: any): Array<{ text: string; label: string }> {
    const parsed = this.safeParseJsonArray(value);

    return parsed
      .map((item: any) => {
        if (item && typeof item === 'object' && 'text' in item && 'label' in item) {
          return {
            text: String(item.text),
            label: String(item.label),
          };
        }

        if (Array.isArray(item) && item.length >= 2) {
          return {
            text: String(item[0]),
            label: String(item[1]),
          };
        }

        return null;
      })
      .filter(Boolean) as Array<{ text: string; label: string }>;
  }

  private topCounts(items: string[], limit = 10) {
    const counts = new Map<string, number>();

    for (const item of items) {
      const clean = item?.trim();
      if (!clean) continue;
      counts.set(clean, (counts.get(clean) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([label, count]) => ({ label, count }));
  }

  private buildChapterDetection(raw: any) {
    const method =
      raw.chapter_detection_method ||
      raw.metodo_capitulo ||
      raw.chapter_method ||
      'unknown'

    const pageRows = this.getChapterPageRows(raw)

    if (pageRows.length === 0) {
      return {
        method,
        total_chapters: 0,
        chapters: [],
      }
    }

    const chapterRanges: Array<{
      title: string
      start_page: number
      end_page: number
    }> = []

    let currentTitle = pageRows[0].chapter
    let startPage = pageRows[0].page
    let endPage = pageRows[0].page

    for (let i = 1; i < pageRows.length; i++) {
      const row = pageRows[i]

      if (row.chapter === currentTitle) {
        endPage = row.page
        continue
      }

      chapterRanges.push({
        title: currentTitle,
        start_page: startPage,
        end_page: endPage,
      })

      currentTitle = row.chapter
      startPage = row.page
      endPage = row.page
    }

    chapterRanges.push({
      title: currentTitle,
      start_page: startPage,
      end_page: endPage,
    })

    return {
      method,
      total_chapters: chapterRanges.length,
      chapters: chapterRanges,
    }
  }

  private buildCleaningSummary(raw: any) {
    const sourceRows = this.getRawPages(raw);

    const normalizedRows = sourceRows
      .map((row: any) => {
        const text =
          row.texto_pagina ??
          row.text ??
          row.page_text ??
          '';

        const totalChars =
          row.n_caracteres ??
          (typeof text === 'string' ? text.length : 0);

        return {
          file: row.archivo ?? row.file ?? row.filename ?? undefined,
          page: row.pagina ?? row.page ?? null,
          chapter: row.capitulo ?? row.chapter ?? undefined,
          text,
          total_chars: totalChars,
        };
      })
      .filter(
        (row: any) =>
          typeof row.page === 'number' &&
          typeof row.text === 'string' &&
          row.text.trim().length > 0,
      )
      .sort((a: any, b: any) => a.page - b.page);

    const pagesAfter = raw.pages_clean ?? normalizedRows.length;
    const pagesExcluded = raw.pages_excluded ?? 0;
    const pagesBefore = raw.page_count ?? pagesAfter + pagesExcluded;

    const charsAfter = normalizedRows.reduce(
      (sum: number, row: any) => sum + (row.total_chars ?? 0),
      0,
    );

    const charsBefore =
      typeof raw.original_chars === 'number'
        ? raw.original_chars
        : typeof raw.characters_before === 'number'
        ? raw.characters_before
        : typeof raw.chars_before === 'number'
          ? raw.chars_before
          : undefined;

    const reductionPercent =
      typeof charsBefore === 'number' && charsBefore > 0
        ? Number(((1 - charsAfter / charsBefore) * 100).toFixed(1))
        : undefined;

    const samplePages = normalizedRows.slice(0, 5).map((row: any) => {
      const previewChars = 100;
      const half = Math.floor(previewChars / 2);
      const totalChars = row.total_chars ?? row.text.length;
      const startExcerpt = row.text.slice(0, Math.min(half, totalChars));
      const endExcerpt = totalChars > previewChars ? row.text.slice(-half) : '';
      const omittedChars = totalChars > previewChars ? totalChars - previewChars : 0;

      return {
        file: row.file,
        page: row.page,
        chapter: row.chapter,
        total_chars: totalChars,
        start_excerpt: startExcerpt,
        end_excerpt: endExcerpt,
        omitted_chars: omittedChars,
      };
    });

    return {
      pages_before: pagesBefore,
      pages_after: pagesAfter,
      chars_before: charsBefore,
      chars_after: charsAfter,
      reduction_percent: reductionPercent,
      extracted_footnotes:
        raw.footnote_count ??
        raw.n_footnotes ??
        (Array.isArray(raw.footnotes) ? raw.footnotes.length : 0),
      sample_pages: samplePages,
    };
  }

  private buildFootnotesSummary(footnotes: Array<{ page: number; text: string; chapter?: string }>) {
    const pages = new Set<number>();
    const chapters = new Set<string>();
    const chapterLabels: string[] = [];

    for (const footnote of footnotes) {
      if (typeof footnote.page === 'number') pages.add(footnote.page);
      if (footnote.chapter?.trim()) {
        const chapter = footnote.chapter.trim();
        chapters.add(chapter);
        chapterLabels.push(chapter);
      }
    }

    return {
      total: footnotes.length,
      pages_with_footnotes: pages.size,
      chapters_with_footnotes: chapters.size,
      by_chapter: this.topCounts(chapterLabels, 10),
    };
  }

  private buildNlpSummary(sentences: Array<{
    tokens?: string[];
    lemmas?: string[];
    pos_tags?: string[];
    entities?: Array<{ text: string; label: string }>;
  }>) {
    const lemmaList: string[] = [];
    const posList: string[] = [];
    const entityLabels: string[] = [];
    let totalEntities = 0;

    for (const sentence of sentences) {
      for (const lemma of sentence.lemmas ?? []) {
        const clean = lemma?.trim()?.toLowerCase();
        if (!clean || clean.length < 3) continue;
        lemmaList.push(clean);
      }

      for (const pos of sentence.pos_tags ?? []) {
        if (pos?.trim()) posList.push(pos.trim());
      }

      for (const entity of sentence.entities ?? []) {
        if (entity?.label?.trim()) {
          entityLabels.push(entity.label.trim());
          totalEntities += 1;
        }
      }
    }

    return {
      processed_sentences: sentences.length,
      unique_lemmas: new Set(lemmaList).size,
      total_entities: totalEntities,
      top_lemmas: this.topCounts(lemmaList, 20),
      top_pos_tags: this.topCounts(posList, 10),
      top_entity_labels: this.topCounts(entityLabels, 10),
    };
  }

  async getLevel0Data(documentId: string, userId: string) {
    const doc = await this.findOne(documentId, userId);
    if (!doc.content) {
      throw new NotFoundException('No processed data found for this document.');
    }

    let raw: any;
    try {
      const dataBuffer = Buffer.isBuffer(doc.content)
        ? doc.content
        : Buffer.from(doc.content);

      const dataString = dataBuffer.toString('utf-8');
      raw = JSON.parse(dataString);
    } catch (e: any) {
      throw new Error(`Failed to parse processed linguistic data: ${e.message}`);
    }

    const normalizedFootnotes = (raw.footnotes ?? []).map((f: any) => ({
      page: f.pagina,
      text: f.nota_al_pie,
      chapter: f.capitulo,
    }));

    const normalizedSentences = (raw.sentences ?? []).map((s: any) => ({
      id: s.ID_oracion,
      page: s.pagina,
      chapter: s.capitulo,
      text: s.oracion_texto,
      n_words: s.n_palabras,
      n_chars: s.n_caracteres,
      tokens: this.safeParseJsonArray(s.tokens),
      lemmas: this.safeParseJsonArray(s.lemas),
      pos_tags: this.safeParseJsonArray(s.pos_tags),
      entities: this.normalizeEntities(s.entidades_NER),
    }));

    const chapterDetection = this.buildChapterDetection(raw);
    const cleaningSummary = this.buildCleaningSummary(raw);
    const footnotesSummary = this.buildFootnotesSummary(normalizedFootnotes);
    const nlpSummary = this.buildNlpSummary(normalizedSentences);

    return {
      title: raw.title,
      author: raw.author,
      language: raw.language,
      processed_at: raw.processed_at,

      page_count: raw.page_count,
      pages_excluded: raw.pages_excluded,
      pages_clean: raw.pages_clean,
      word_count: raw.word_count,
      token_count: raw.token_count,
      sentence_count: raw.sentence_count,
      footnote_count: raw.footnote_count,

      chapter_detection_method: raw.chapter_detection_method,
      level0_config: raw.level0_config,
      chapter_detection: chapterDetection,
      cleaning_summary: cleaningSummary,
      footnotes_summary: footnotesSummary,
      nlp_summary: nlpSummary,

      chapters: raw.chapters ?? [],
      footnotes: normalizedFootnotes,
      sentences: normalizedSentences,
    };
  }

  private async assertCorpusAccess(corpusId: string, userId: string) {
    const link = await this.prisma.userCorpus.findUnique({
      where: { userId_corpusId: { userId, corpusId } },
    });

    if (!link) {
      throw new NotFoundException('Corpus not found or no access');
    }
  }
}
