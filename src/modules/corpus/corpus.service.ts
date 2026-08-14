import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCorpusDto } from './dto/create-corpus.dto';
import {
  normalizeCorpusLevel0Config,
  resolveLevel0Config,
} from '../../common/level0-config';

@Injectable()
export class CorpusService {
  constructor(private prisma: PrismaService) {}

  async findAllByUser(userId: string) {
    return this.prisma.corpus.findMany({
      where: { users: { some: { userId } } },
      include: {
        _count: { select: { documents: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const corpus = await this.prisma.corpus.findFirst({
      where: { id, users: { some: { userId } } },
      include: {
        documents: {
          select: {
            id: true,
            title: true,
            documentType: true,
            language: true,
            pageCount: true,
            tokenCount: true,
            createdAt: true,
            level0ConfigOverrides: true,
            analysis: {
              select: {
                id: true,
                level0Status: true,
                level1Status: true,
                level2Status: true,
                level3Status: true,
                level4Status: true,
                level5Status: true,
              },
            },
          },
        },
      },
    });

    if (!corpus) throw new NotFoundException('Corpus not found');

    return {
      ...corpus,
      effectiveLevel0Config: resolveLevel0Config(corpus.level0Config, null),
    };
  }

  async create(userId: string, dto: CreateCorpusDto) {
    return this.prisma.corpus.create({
      data: {
        ...dto,
        users: { create: { userId, role: 'OWNER' } },
      },
    });
  }

  async update(id: string, userId: string, dto: Partial<CreateCorpusDto>) {
    await this.assertOwner(id, userId);
    return this.prisma.corpus.update({ where: { id }, data: dto });
  }

  async updateLevel0Config(id: string, userId: string, config: unknown) {
    await this.assertOwner(id, userId);

    const processingCount = await this.prisma.documentAnalysis.count({
      where: {
        document: { corpusId: id },
        level0Status: 'PROCESSING',
      },
    });

    if (processingCount > 0) {
      throw new BadRequestException(
        'Level 0 configuration cannot be changed while documents in this corpus are processing.',
      );
    }

    const normalized = normalizeCorpusLevel0Config(config);

    const corpus = await this.prisma.corpus.update({
      where: { id },
      data: {
        level0Config: normalized as any,
      },
    });

    await this.invalidateCorpusAnalyses(id);

    return {
      ...corpus,
      effectiveLevel0Config: normalized,
    };
  }

  async remove(id: string, userId: string) {
    await this.assertOwner(id, userId);
    return this.prisma.corpus.delete({ where: { id } });
  }

  private async invalidateCorpusAnalyses(corpusId: string) {
    const whereDocument = {
      document: { corpusId },
    };

    await this.prisma.$transaction([
      this.prisma.documentAnalysis.updateMany({
        where: {
          ...whereDocument,
          level0Status: { not: 'PENDING' },
        },
        data: { level0Status: 'OUTDATED' },
      }),
      this.prisma.documentAnalysis.updateMany({
        where: {
          ...whereDocument,
          level1Status: { not: 'PENDING' },
        },
        data: { level1Status: 'OUTDATED' },
      }),
      this.prisma.documentAnalysis.updateMany({
        where: {
          ...whereDocument,
          level2Status: { not: 'PENDING' },
        },
        data: { level2Status: 'OUTDATED' },
      }),
      this.prisma.documentAnalysis.updateMany({
        where: {
          ...whereDocument,
          level3Status: { not: 'PENDING' },
        },
        data: { level3Status: 'OUTDATED' },
      }),
      this.prisma.documentAnalysis.updateMany({
        where: {
          ...whereDocument,
          level4Status: { not: 'PENDING' },
        },
        data: { level4Status: 'OUTDATED' },
      }),
      this.prisma.documentAnalysis.updateMany({
        where: {
          ...whereDocument,
          level5Status: { not: 'PENDING' },
        },
        data: { level5Status: 'OUTDATED' },
      }),
    ]);
  }

  private async assertOwner(corpusId: string, userId: string) {
    const link = await this.prisma.userCorpus.findUnique({
      where: { userId_corpusId: { userId, corpusId } },
    });
    if (!link) throw new NotFoundException('Corpus not found');
    if (link.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can modify this corpus');
    }
  }
}
