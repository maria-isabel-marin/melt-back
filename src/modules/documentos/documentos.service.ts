import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import { AiProvider } from '@prisma/client';

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

    if (!doc || doc.corpus.users.length === 0) throw new NotFoundException('Document not found');
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
        data: { aiProvider, level0Status: 'APPROVED' },
      });
    }

    return this.prisma.documentAnalysis.create({
      data: {
        documentId,
        aiProvider,
        level0Status: 'APPROVED',
      },
    });
  }

  async getLevel0Data(documentId: string, userId: string) {
    const doc = await this.findOne(documentId, userId);
    if (!doc.content) {
      throw new NotFoundException('No processed data found for this document.');
    }

    let raw: any;
    try {
      const dataString = doc.content.toString();
      raw = JSON.parse(dataString);
    } catch (e) {
      throw new Error('Failed to parse processed linguistic data.');
    }

    // Normalizar nombres de campo del script Python (español) → frontend (inglés)
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
      // Capítulos — ya tienen los campos correctos (name, start_page, end_page)
      chapters: raw.chapters ?? [],
      // Notas al pie: pagina → page, nota_al_pie → text
      footnotes: (raw.footnotes ?? []).map((f: any) => ({
        page: f.pagina,
        text: f.nota_al_pie,
        chapter: f.capitulo,
      })),
      // Oraciones: mapear campos en español → inglés
      sentences: (raw.sentences ?? []).map((s: any) => ({
        id: s.ID_oracion,
        page: s.pagina,
        chapter: s.capitulo,
        text: s.oracion_texto,
        n_words: s.n_palabras,
        n_chars: s.n_caracteres,
        tokens: s.tokens ?? [],
        lemas: s.lemas ?? [],
        pos_tags: s.pos_tags ?? [],
        entities: s.entidades_NER ?? [],
      })),
    };
  }

  private async assertCorpusAccess(corpusId: string, userId: string) {
    const link = await this.prisma.userCorpus.findUnique({
      where: { userId_corpusId: { userId, corpusId } },
    });
    if (!link) throw new NotFoundException('Corpus not found or no access');
  }
}
