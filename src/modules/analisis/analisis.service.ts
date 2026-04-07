import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NivelStatus, ItemStatus } from '@prisma/client';

// Orden de niveles para la propagación de desactualización
const NIVEL_ORDER = ['nivel1Status', 'nivel2Status', 'nivel3Status', 'nivel4Status', 'nivel5Status'] as const;
type NivelKey = (typeof NIVEL_ORDER)[number];

@Injectable()
export class AnalisisService {
  constructor(private prisma: PrismaService) {}

  async getAnalisis(analisisId: string) {
    const analisis = await this.prisma.analisisDocumento.findUnique({
      where: { id: analisisId },
      include: { documento: true },
    });
    if (!analisis) throw new NotFoundException('Análisis no encontrado');
    return analisis;
  }

  async getFullAnalisis(analisisId: string) {
    return this.prisma.analisisDocumento.findUnique({
      where: { id: analisisId },
      include: {
        documento: true,
        metaforasPrimarias: {
          include: { correspondenciasOntologicas: true, correspondenciasEpistemicas: true },
        },
        metaforasConvencionales: { include: { metaforasPrimarias: true } },
        escenarios: {
          include: { gruposSociales: true, secuenciaNarrativa: true, sesgoEvaluativo: true, afectos: true },
        },
        regimenes: { include: { escenarios: true, metaforasDerivadas: true, ejeValorativo: true } },
        narrativa: true,
      },
    });
  }

  /**
   * Marks a nivel as approved and cascades DESACTUALIZADO to all downstream levels.
   */
  async approveNivel(analisisId: string, nivel: number) {
    const key = NIVEL_ORDER[nivel - 1];
    if (!key) throw new BadRequestException('Nivel inválido (1–5)');

    const downstreamKeys = NIVEL_ORDER.slice(nivel);
    const downstreamUpdate = Object.fromEntries(
      downstreamKeys.map((k) => [k, NivelStatus.DESACTUALIZADO]),
    );

    return this.prisma.analisisDocumento.update({
      where: { id: analisisId },
      data: {
        [key]: NivelStatus.APROBADO,
        ...downstreamUpdate,
      },
    });
  }

  /**
   * Sets nivel status to PROCESANDO before AI call.
   */
  async setNivelProcesando(analisisId: string, nivel: number) {
    const key = NIVEL_ORDER[nivel - 1];
    if (!key) throw new BadRequestException('Nivel inválido');
    return this.prisma.analisisDocumento.update({
      where: { id: analisisId },
      data: { [key]: NivelStatus.PROCESANDO },
    });
  }

  /**
   * Sets nivel status to PENDIENTE_REVISION after AI processing.
   */
  async setNivelPendienteRevision(analisisId: string, nivel: number) {
    const key = NIVEL_ORDER[nivel - 1];
    if (!key) throw new BadRequestException('Nivel inválido');
    return this.prisma.analisisDocumento.update({
      where: { id: analisisId },
      data: { [key]: NivelStatus.PENDIENTE_REVISION },
    });
  }

  /**
   * Updates item status for any reviewable entity.
   */
  async updateItemStatus(
    model: 'metaforaPrimaria' | 'correspondenciaOntologica' | 'correspondenciaEpistemica' |
           'metaforaConvencional' | 'escenarioMetaforico' | 'grupoSocialPosicionado' |
           'secuenciaNarrativa' | 'sesgoEvaluativo' | 'afecto' | 'regimenDeMetaforas' |
           'regimenMetaforaDerivada' | 'ejeValorativo' | 'narrativaCultural',
    id: string,
    status: ItemStatus,
    analystNote?: string,
  ) {
    return (this.prisma[model] as any).update({
      where: { id },
      data: { itemStatus: status, ...(analystNote !== undefined ? { analystNote } : {}) },
    });
  }

  /**
   * Approves all items of a nivel in bulk.
   */
  async approveAllItems(analisisId: string, nivel: number) {
    const updates: Promise<unknown>[] = [];

    if (nivel === 1) {
      updates.push(
        this.prisma.metaforaPrimaria.updateMany({ where: { analisisId }, data: { itemStatus: 'APROBADO' } }),
        this.prisma.correspondenciaOntologica.updateMany({
          where: { metaforaPrimaria: { analisisId } },
          data: { itemStatus: 'APROBADO' },
        }),
        this.prisma.correspondenciaEpistemica.updateMany({
          where: { metaforaPrimaria: { analisisId } },
          data: { itemStatus: 'APROBADO' },
        }),
      );
    } else if (nivel === 2) {
      updates.push(
        this.prisma.metaforaConvencional.updateMany({ where: { analisisId }, data: { itemStatus: 'APROBADO' } }),
      );
    } else if (nivel === 3) {
      updates.push(
        this.prisma.escenarioMetaforico.updateMany({ where: { analisisId }, data: { itemStatus: 'APROBADO' } }),
      );
    } else if (nivel === 4) {
      updates.push(
        this.prisma.regimenDeMetaforas.updateMany({ where: { analisisId }, data: { itemStatus: 'APROBADO' } }),
      );
    } else if (nivel === 5) {
      updates.push(
        this.prisma.narrativaCultural.updateMany({ where: { analisisId }, data: { itemStatus: 'APROBADO' } }),
      );
    }

    await Promise.all(updates);
    return this.approveNivel(analisisId, nivel);
  }
}
