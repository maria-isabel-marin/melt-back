import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCorpusDto } from './dto/create-corpus.dto';

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
    return corpus;
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

  async remove(id: string, userId: string) {
    await this.assertOwner(id, userId);
    return this.prisma.corpus.delete({ where: { id } });
  }

  private async assertOwner(corpusId: string, userId: string) {
    const link = await this.prisma.userCorpus.findUnique({
      where: { userId_corpusId: { userId, corpusId } },
    });
    if (!link) throw new NotFoundException('Corpus not found');
    if (link.role !== 'OWNER') throw new ForbiddenException('Only the owner can modify this corpus');
  }
}
