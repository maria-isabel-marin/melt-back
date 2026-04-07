import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import { AiProvider } from '@prisma/client';

@Injectable()
export class DocumentosService {
  constructor(private prisma: PrismaService) {}

  async findAllByCorpus(corpusId: string, userId: string) {
    // Verify user has access to corpus
    await this.assertCorpusAccess(corpusId, userId);

    return this.prisma.documento.findMany({
      where: { corpusId },
      include: {
        analisis: {
          select: {
            id: true,
            aiProvider: true,
            nivel0Status: true,
            nivel1Status: true,
            nivel2Status: true,
            nivel3Status: true,
            nivel4Status: true,
            nivel5Status: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const doc = await this.prisma.documento.findUnique({
      where: { id },
      include: {
        corpus: { include: { usuarios: { where: { userId } } } },
        analisis: true,
      },
    });

    if (!doc || doc.corpus.usuarios.length === 0) throw new NotFoundException('Documento no encontrado');
    return doc;
  }

  async create(dto: CreateDocumentoDto, userId: string) {
    await this.assertCorpusAccess(dto.corpusId, userId);

    return this.prisma.documento.create({
      data: {
        corpusId: dto.corpusId,
        titulo: dto.titulo,
        descripcion: dto.descripcion,
        autor: dto.autor,
        tipoDocumento: dto.tipoDocumento,
        idioma: dto.idioma,
        nroPaginas: dto.nroPaginas,
        fileUrl: dto.fileUrl,
      },
    });
  }

  async remove(id: string, userId: string) {
    const doc = await this.findOne(id, userId);
    return this.prisma.documento.delete({ where: { id: doc.id } });
  }

  async initializeAnalisis(documentoId: string, userId: string, aiProvider: AiProvider) {
    const doc = await this.findOne(documentoId, userId);

    if (doc.analisis) {
      return this.prisma.analisisDocumento.update({
        where: { documentoId },
        data: { aiProvider, nivel0Status: 'APROBADO' },
      });
    }

    return this.prisma.analisisDocumento.create({
      data: {
        documentoId,
        aiProvider,
        nivel0Status: 'APROBADO',
      },
    });
  }

  private async assertCorpusAccess(corpusId: string, userId: string) {
    const link = await this.prisma.userCorpus.findUnique({
      where: { userId_corpusId: { userId, corpusId } },
    });
    if (!link) throw new NotFoundException('Corpus no encontrado o sin acceso');
  }
}
