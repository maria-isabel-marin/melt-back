import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCorpusDto } from './dto/create-corpus.dto';

@Injectable()
export class CorpusService {
  constructor(private prisma: PrismaService) {}

  async findAllByUser(userId: string) {
    return this.prisma.corpus.findMany({
      where: { usuarios: { some: { userId } } },
      include: {
        _count: { select: { documentos: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const corpus = await this.prisma.corpus.findFirst({
      where: { id, usuarios: { some: { userId } } },
      include: {
        documentos: {
          select: {
            id: true,
            titulo: true,
            tipoDocumento: true,
            idioma: true,
            nroPaginas: true,
            nroTokens: true,
            createdAt: true,
            analisis: { select: { nivel0Status: true, nivel1Status: true, nivel2Status: true, nivel3Status: true, nivel4Status: true, nivel5Status: true } },
          },
        },
      },
    });

    if (!corpus) throw new NotFoundException('Corpus no encontrado');
    return corpus;
  }

  async create(userId: string, dto: CreateCorpusDto) {
    return this.prisma.corpus.create({
      data: {
        ...dto,
        usuarios: { create: { userId, role: 'OWNER' } },
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
    if (!link) throw new NotFoundException('Corpus no encontrado');
    if (link.role !== 'OWNER') throw new ForbiddenException('Solo el propietario puede modificar este corpus');
  }
}
