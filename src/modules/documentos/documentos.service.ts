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

  private async assertCorpusAccess(corpusId: string, userId: string) {
    const link = await this.prisma.userCorpus.findUnique({
      where: { userId_corpusId: { userId, corpusId } },
    });
    if (!link) throw new NotFoundException('Corpus not found or no access');
  }
}
