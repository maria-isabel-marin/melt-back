import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LevelStatus, ItemStatus } from '@prisma/client';

const LEVEL_ORDER = ['level1Status', 'level2Status', 'level3Status', 'level4Status', 'level5Status'] as const;
type LevelKey = (typeof LEVEL_ORDER)[number];

@Injectable()
export class AnalisisService {
  constructor(private prisma: PrismaService) {}

  async getAnalisis(analysisId: string) {
    const analysis = await this.prisma.documentAnalysis.findUnique({
      where: { id: analysisId },
      include: { document: true },
    });
    if (!analysis) throw new NotFoundException('Analysis not found');
    return analysis;
  }

  async getFullAnalisis(analysisId: string) {
    return this.prisma.documentAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        document: true,
        primaryMetaphors: {
          include: { ontologicalMappings: true, epistemicMappings: true },
        },
        conventionalMetaphors: { include: { primaryMetaphors: true } },
        scenarios: {
          include: { socialGroups: true, narrativeSequence: true, evaluativeBias: true, affects: true },
        },
        regimes: { include: { scenarios: true, derivedMetaphors: true, valueAxis: true } },
        culturalNarrative: true,
      },
    });
  }

  async approveNivel(analysisId: string, nivel: number) {
    const key = LEVEL_ORDER[nivel - 1];
    if (!key) throw new BadRequestException('Invalid level (1–5)');

    // Only mark downstream levels as OUTDATED if they were already processed
    // (PENDING_REVIEW or APPROVED). Levels still PENDING stay PENDING.
    const current = await this.prisma.documentAnalysis.findUnique({
      where: { id: analysisId },
    });

    const downstreamKeys = LEVEL_ORDER.slice(nivel);
    const downstreamUpdate: Partial<Record<LevelKey, LevelStatus>> = {};
    for (const k of downstreamKeys) {
      const currentStatus = current?.[k];
      if (currentStatus && currentStatus !== LevelStatus.PENDING) {
        downstreamUpdate[k] = LevelStatus.OUTDATED;
      }
    }

    return this.prisma.documentAnalysis.update({
      where: { id: analysisId },
      data: {
        [key]: LevelStatus.APPROVED,
        ...downstreamUpdate,
      },
    });
  }

  async setNivelProcesando(analysisId: string, nivel: number) {
    const key = LEVEL_ORDER[nivel - 1];
    if (!key) throw new BadRequestException('Invalid level');
    return this.prisma.documentAnalysis.update({
      where: { id: analysisId },
      data: { [key]: LevelStatus.PROCESSING },
    });
  }

  async setNivelPendienteRevision(analysisId: string, nivel: number) {
    const key = LEVEL_ORDER[nivel - 1];
    if (!key) throw new BadRequestException('Invalid level');
    return this.prisma.documentAnalysis.update({
      where: { id: analysisId },
      data: { [key]: LevelStatus.PENDING_REVIEW },
    });
  }

  async updateItemStatus(
    model:
      | 'primaryMetaphor'
      | 'ontologicalMapping'
      | 'epistemicMapping'
      | 'conventionalMetaphor'
      | 'metaphoricalScenario'
      | 'positionedSocialGroup'
      | 'narrativeSequence'
      | 'evaluativeBias'
      | 'affect'
      | 'metaphorRegime'
      | 'regimeDerivedMetaphor'
      | 'valueAxis'
      | 'culturalNarrative',
    id: string,
    status: ItemStatus,
    analystNote?: string,
  ) {
    return (this.prisma[model] as any).update({
      where: { id },
      data: { itemStatus: status, ...(analystNote !== undefined ? { analystNote } : {}) },
    });
  }

  async approveAllItems(analysisId: string, nivel: number) {
    const updates: Promise<unknown>[] = [];

    if (nivel === 1) {
      updates.push(
        this.prisma.primaryMetaphor.updateMany({ where: { analysisId }, data: { itemStatus: 'APPROVED' } }),
        this.prisma.ontologicalMapping.updateMany({
          where: { primaryMetaphor: { analysisId } },
          data: { itemStatus: 'APPROVED' },
        }),
        this.prisma.epistemicMapping.updateMany({
          where: { primaryMetaphor: { analysisId } },
          data: { itemStatus: 'APPROVED' },
        }),
      );
    } else if (nivel === 2) {
      updates.push(
        this.prisma.conventionalMetaphor.updateMany({ where: { analysisId }, data: { itemStatus: 'APPROVED' } }),
      );
    } else if (nivel === 3) {
      updates.push(
        this.prisma.metaphoricalScenario.updateMany({ where: { analysisId }, data: { itemStatus: 'APPROVED' } }),
      );
    } else if (nivel === 4) {
      updates.push(
        this.prisma.metaphorRegime.updateMany({ where: { analysisId }, data: { itemStatus: 'APPROVED' } }),
      );
    } else if (nivel === 5) {
      updates.push(
        this.prisma.culturalNarrative.updateMany({ where: { analysisId }, data: { itemStatus: 'APPROVED' } }),
      );
    }

    await Promise.all(updates);
    return this.approveNivel(analysisId, nivel);
  }
}
