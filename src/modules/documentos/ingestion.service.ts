import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestDocumentoDto } from './dto/ingest-documento.dto';
import { Language, DocumentType } from '@prisma/client';
import { spawn } from 'child_process';
import { join, extname, basename } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import {
  type Level0Config,
  resolveLevel0Config,
} from '../../common/level0-config';

type ProgressStepStatus = 'pending' | 'running' | 'done' | 'error';
type ProgressStatus = 'PENDING' | 'PROCESSING' | 'APPROVED' | 'FAILED';

type Level0ProgressStep = {
  key: string;
  label: string;
  status: ProgressStepStatus;
  message?: string;
};

type Level0ProgressState = {
  documentId: string;
  status: ProgressStatus;
  currentStep: string | null;
  steps: Level0ProgressStep[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

type Level0ProgressResponse = Level0ProgressState & {
  progress: number;
  message?: string;
};

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly level0Progress = new Map<string, Level0ProgressState>();

  constructor(private prisma: PrismaService) {}

  private baseSteps(): Level0ProgressStep[] {
    return [
      { key: 'document_ready', label: 'Document ready', status: 'pending' },
      { key: 'chapter_detection', label: 'Chapter detection', status: 'pending' },
      { key: 'text_cleaning', label: 'Text cleaning', status: 'pending' },
      { key: 'footnote_extraction', label: 'Footnote extraction', status: 'pending' },
      { key: 'sentence_segmentation', label: 'Sentence segmentation', status: 'pending' },
      { key: 'linguistic_preprocessing', label: 'Linguistic preprocessing', status: 'pending' },
      { key: 'save_results', label: 'Saving results', status: 'pending' },
    ];
  }

  private getStepPercent(stepKey: string | null, status: ProgressStatus): number {
    if (status === 'PENDING') return 0;
    if (status === 'APPROVED') return 100;

    const map: Record<string, number> = {
      document_ready: 10,
      chapter_detection: 25,
      text_cleaning: 42,
      footnote_extraction: 55,
      sentence_segmentation: 68,
      linguistic_preprocessing: 86,
      save_results: 96,
    };

    if (!stepKey) return status === 'FAILED' ? 0 : 5;
    return map[stepKey] ?? 5;
  }

  private buildProgressResponse(state: Level0ProgressState): Level0ProgressResponse {
    const current = state.currentStep
      ? state.steps.find((step) => step.key === state.currentStep)
      : undefined;

    return {
      ...state,
      progress: this.getStepPercent(state.currentStep, state.status),
      message:
        state.error ||
        current?.message ||
        (state.status === 'APPROVED'
          ? 'Level 0 processing completed.'
          : state.status === 'PENDING'
            ? 'Document uploaded and waiting for processing.'
            : 'Processing Level 0...'),
    };
  }

  private setPendingProgress(documentId: string) {
    const steps = this.baseSteps();
    this.level0Progress.set(documentId, {
      documentId,
      status: 'PENDING',
      currentStep: null,
      steps,
    });
  }

  private setProcessingProgress(documentId: string) {
    const steps = this.baseSteps().map((step): Level0ProgressStep => {
      if (step.key === 'document_ready') {
        return {
          ...step,
          status: 'done',
          message: 'File uploaded and ready to process.',
        };
      }

      if (step.key === 'chapter_detection') {
        return {
          ...step,
          status: 'running',
          message: 'Starting chapter detection.',
        };
      }

      return step;
    });

    this.level0Progress.set(documentId, {
      documentId,
      status: 'PROCESSING',
      currentStep: 'chapter_detection',
      steps,
      startedAt: new Date().toISOString(),
    });
  }

  private advanceToStep(documentId: string, stepKey: string, message?: string) {
    const progress = this.level0Progress.get(documentId);
    if (!progress) return;

    const targetIndex = progress.steps.findIndex((step) => step.key === stepKey);
    if (targetIndex === -1) return;

    progress.steps = progress.steps.map((step, index) => {
      if (index < targetIndex) {
        return {
          ...step,
          status: step.status === 'error' ? 'error' : 'done',
        };
      }

      if (index === targetIndex) {
        return {
          ...step,
          status: 'running',
          message: message ?? step.message,
        };
      }

      return {
        ...step,
        status: step.status === 'done' ? 'done' : 'pending',
      };
    });

    progress.status = 'PROCESSING';
    progress.currentStep = stepKey;
    this.level0Progress.set(documentId, { ...progress });
  }

  private updateStepMessage(documentId: string, stepKey: string, message: string) {
    const progress = this.level0Progress.get(documentId);
    if (!progress) return;

    progress.steps = progress.steps.map((step) =>
      step.key === stepKey ? { ...step, message } : step,
    );

    this.level0Progress.set(documentId, { ...progress });
  }

  private completeProgress(documentId: string) {
    const progress = this.level0Progress.get(documentId);
    if (!progress) return;

    progress.steps = progress.steps.map((step) => ({
      ...step,
      status: 'done',
    }));
    progress.status = 'APPROVED';
    progress.currentStep = null;
    progress.completedAt = new Date().toISOString();
    progress.error = undefined;

    this.level0Progress.set(documentId, { ...progress });
  }

  private failProgress(documentId: string, error: string) {
    const progress = this.level0Progress.get(documentId) ?? {
      documentId,
      status: 'FAILED' as ProgressStatus,
      currentStep: null,
      steps: this.baseSteps(),
    };

    progress.status = 'FAILED';
    progress.error = error;
    progress.completedAt = new Date().toISOString();

    if (progress.currentStep) {
      progress.steps = progress.steps.map((step) =>
        step.key === progress.currentStep
          ? { ...step, status: 'error', message: error }
          : step,
      );
    }

    this.level0Progress.set(documentId, { ...progress });
  }

  private normalizeLogText(line: string) {
    return line
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\r/g, '')
      .trim();
  }

  private markProgressFromLog(documentId: string, line: string) {
    const text = this.normalizeLogText(line);

    if (
      text.includes('paso 3') ||
      text.includes('extrayendo texto') ||
      text.includes('capitulos detectados via toc') ||
      text.includes('capitulos detectados via indice impreso') ||
      text.includes('capitulos detectados via tamano de fuente') ||
      text.includes('metodo de capitulos') ||
      text.includes('chapter detection')
    ) {
      this.advanceToStep(documentId, 'chapter_detection', line);
      return;
    }

    if (
      text.includes('paso 3b') ||
      text.includes('detectando encabezados repetidos') ||
      text.includes('inyectando nombres de capitulos') ||
      text.includes('excluyendo paginas completas') ||
      text.includes('resultado de la limpieza') ||
      text.includes('capitulos presentes tras limpieza') ||
      text.includes('text cleaning') ||
      text.includes('limpieza')
    ) {
      this.advanceToStep(documentId, 'text_cleaning', line);
      this.updateStepMessage(documentId, 'text_cleaning', line);
      return;
    }

    if (
      text.includes('paso 3d') ||
      text.includes('notas al pie extraidas') ||
      text.includes('notas al pie extraídas') ||
      text.includes('no se extrajeron notas al pie') ||
      (text.includes('muestra de') && text.includes('notas al pie')) ||
      text.includes('footnote')
    ) {
      this.advanceToStep(documentId, 'footnote_extraction', line);
      this.updateStepMessage(documentId, 'footnote_extraction', line);
      return;
    }

    if (
      text.includes('paso 4') ||
      text.includes('segmentando oraciones') ||
      text.includes('segmentacion completada') ||
      text.includes('segmentación completada') ||
      text.includes('sentence segmentation')
    ) {
      this.advanceToStep(documentId, 'sentence_segmentation', line);
      this.updateStepMessage(documentId, 'sentence_segmentation', line);

      if (
        text.includes('segmentacion completada') ||
        text.includes('segmentación completada')
      ) {
        this.advanceToStep(documentId, 'linguistic_preprocessing', line);
      }
      return;
    }

    if (
      text.includes('paso 5') ||
      text.includes('cargando modelo spacy') ||
      text.includes('preprocesamiento completado') ||
      text.includes('top lemas') ||
      text.includes('top etiquetas ner') ||
      text.includes('linguistic preprocessing')
    ) {
      this.advanceToStep(documentId, 'linguistic_preprocessing', line);
      this.updateStepMessage(documentId, 'linguistic_preprocessing', line);

      if (text.includes('preprocesamiento completado')) {
        this.advanceToStep(documentId, 'save_results', line);
      }
      return;
    }

    if (
      text.includes('paso 6') ||
      text.includes('paso 7') ||
      text.includes('serializando json') ||
      text.includes('exportacion de resultados') ||
      text.includes('exportación de resultados') ||
      text.includes('resumen final') ||
      text.includes('save') ||
      text.includes('guardando')
    ) {
      this.advanceToStep(documentId, 'save_results', line);
      this.updateStepMessage(documentId, 'save_results', line);
    }
  }

  private async assertCorpusAccess(corpusId: string, userId: string) {
    const corpus = await this.prisma.userCorpus.findUnique({
      where: { userId_corpusId: { userId, corpusId } },
    });

    if (!corpus) {
      throw new NotFoundException('Corpus no encontrado o sin acceso');
    }
  }

  private async findDocumentWithAccess(documentId: string, userId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        corpus: { include: { users: { where: { userId } } } },
        analysis: true,
      },
    });

    if (!doc || doc.corpus.users.length === 0) {
      throw new NotFoundException('Documento no encontrado o sin acceso');
    }

    return doc;
  }

  private ensureUploadsDir() {
    const uploadsDir = join(process.cwd(), 'uploads', 'documents');
    if (!existsSync(uploadsDir)) {
      mkdirSync(uploadsDir, { recursive: true });
    }
    return uploadsDir;
  }

  private sanitizeFilename(name: string) {
    return name.replace(/[^\w.\-]+/g, '_');
  }

  private resolveStoredFilePath(fileUrl: string) {
    if (!fileUrl) {
      throw new BadRequestException('El documento no tiene archivo asociado');
    }

    if (existsSync(fileUrl)) return fileUrl;

    const normalized = fileUrl.replace(/^\/+/, '');
    return join(process.cwd(), normalized);
  }

  async uploadFileOnly(
    file: Express.Multer.File,
    metadata: {
      corpusId: string;
      title: string;
      author?: string;
      language?: Language;
      documentType?: DocumentType;
      description?: string;
      pageCount?: number;
    },
    userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo');
    }

    await this.assertCorpusAccess(metadata.corpusId, userId);

    const uploadsDir = this.ensureUploadsDir();

    const originalExt = extname(file.originalname || '').toLowerCase() || '.txt';
    const safeBase = this.sanitizeFilename(
      basename(file.originalname || metadata.title || 'documento', originalExt),
    );
    const storedFileName = `${Date.now()}_${safeBase}${originalExt}`;
    const storedFilePath = join(uploadsDir, storedFileName);

    writeFileSync(storedFilePath, file.buffer);

    const storedFileUrl = `/uploads/documents/${storedFileName}`;

    const document = await this.prisma.document.create({
      data: {
        corpusId: metadata.corpusId,
        title: metadata.title,
        description: metadata.description,
        author: metadata.author,
        documentType: metadata.documentType || 'OTHER',
        language: metadata.language || 'SPANISH',
        pageCount: metadata.pageCount,
        fileUrl: storedFileUrl,
      },
    });

    await this.prisma.documentAnalysis.upsert({
      where: { documentId: document.id },
      update: {
        level0Status: 'PENDING',
      },
      create: {
        documentId: document.id,
        level0Status: 'PENDING',
      },
    });

    this.setPendingProgress(document.id);

    return document;
  }

  async processLevel0(documentId: string, userId: string) {
    const doc = await this.findDocumentWithAccess(documentId, userId);

    if (!doc.fileUrl) {
      throw new BadRequestException('El documento no tiene archivo cargado para procesar');
    }

    if (doc.analysis?.level0Status === 'PROCESSING') {
      return { started: true };
    }

    const storedFilePath = this.resolveStoredFilePath(doc.fileUrl);

    if (!existsSync(storedFilePath)) {
      throw new NotFoundException('No se encontró el archivo original del documento');
    }

    const level0Config = resolveLevel0Config(
      doc.corpus.level0Config,
      doc.level0ConfigOverrides,
    );

    await this.prisma.documentAnalysis.upsert({
      where: { documentId: doc.id },
      update: { level0Status: 'PROCESSING' },
      create: {
        documentId: doc.id,
        level0Status: 'PROCESSING',
      },
    });

    this.setProcessingProgress(doc.id);

    void this.runLevel0InBackground(doc.id, storedFilePath, {
      corpusId: doc.corpusId,
      title: doc.title,
      author: doc.author || undefined,
      language: doc.language,
      description: doc.description || undefined,
      pageCount: doc.pageCount || undefined,
      hadProcessedContent: !!doc.content,
      level0Config,
    });

    return { started: true };
  }

  private async runLevel0InBackground(
    documentId: string,
    storedFilePath: string,
    metadata: {
      corpusId: string;
      title: string;
      author?: string;
      language?: Language;
      description?: string;
      pageCount?: number;
      hadProcessedContent: boolean;
      level0Config: Level0Config;
    },
  ) {
    try {
      const pythonOutput = await this.runPythonIngestion(
        storedFilePath,
        {
          title: metadata.title,
          author: metadata.author,
          language: metadata.language,
        },
        metadata.level0Config,
        (line) => this.markProgressFromLog(documentId, line),
      );

      const wordCount = pythonOutput.word_count || 0;
      const tokenCount = pythonOutput.token_count || Math.ceil(wordCount * 1.3);
      const pageCount = pythonOutput.page_count || metadata.pageCount || 0;
      const dataBuffer = Buffer.from(JSON.stringify(pythonOutput), 'utf-8');

      const updatedDocument = await this.prisma.document.update({
        where: { id: documentId },
        data: {
          content: dataBuffer,
          pageCount,
          tokenCount,
          author: metadata.author || pythonOutput.author || 'Desconocido',
          description:
            metadata.description ||
            `Preprocesado de Nivel 0. Contiene ${pythonOutput.sentences?.length || 0} oraciones.`,
        },
      });

      await this.prisma.documentAnalysis.upsert({
        where: { documentId },
        update: { level0Status: 'APPROVED' },
        create: {
          documentId,
          level0Status: 'APPROVED',
        },
      });

      if (!metadata.hadProcessedContent) {
        await this.prisma.corpus.update({
          where: { id: metadata.corpusId },
          data: {
            wordCount: { increment: wordCount },
          },
        });
      }

      this.completeProgress(documentId);

      this.logger.log(
        `[N0] Procesamiento completado para documento ${updatedDocument.id}`,
      );
    } catch (error: any) {
      await this.prisma.documentAnalysis.upsert({
        where: { documentId },
        update: { level0Status: 'PENDING' },
        create: {
          documentId,
          level0Status: 'PENDING',
        },
      });

      this.failProgress(
        documentId,
        error?.message || 'Error en el preprocesamiento lingüístico',
      );

      this.logger.error(
        `[N0] Error procesando documento ${documentId}: ${error?.message || error}`,
      );
    }
  }

  async getLevel0Progress(documentId: string, userId: string) {
    const doc = await this.findDocumentWithAccess(documentId, userId);

    const existing = this.level0Progress.get(doc.id);
    if (existing) return this.buildProgressResponse(existing);

    if (doc.analysis?.level0Status === 'APPROVED') {
      const progress: Level0ProgressState = {
        documentId: doc.id,
        status: 'APPROVED',
        currentStep: null,
        completedAt: new Date().toISOString(),
        steps: this.baseSteps().map((step) => ({ ...step, status: 'done' })),
      };
      this.level0Progress.set(doc.id, progress);
      return this.buildProgressResponse(progress);
    }

    if (doc.analysis?.level0Status === 'PROCESSING') {
      this.setProcessingProgress(doc.id);
      return this.buildProgressResponse(this.level0Progress.get(doc.id)!);
    }

    this.setPendingProgress(doc.id);
    return this.buildProgressResponse(this.level0Progress.get(doc.id)!);
  }

  async ingestFile(
    file: Express.Multer.File,
    metadata: {
      corpusId: string;
      title: string;
      author?: string;
      language?: Language;
      documentType?: DocumentType;
      description?: string;
      pageCount?: number;
    },
    userId: string,
  ) {
    const document = await this.uploadFileOnly(file, metadata, userId);
    return this.processLevel0(document.id, userId);
  }

  async ingestFileWithPipeline(
    file: Express.Multer.File,
    pipelineId: string,
    userId: string,
  ) {
    const pipeline = await (this.prisma as any).pipeline.findUnique({
      where: { id: pipelineId },
      include: { corpus: { select: { userCorpusId: true } } },
    });

    if (!pipeline) {
      throw new NotFoundException('Pipeline de ingestión no encontrado');
    }

    const userCorpus = await this.prisma.userCorpus.findUnique({
      where: { userId_corpusId: { userId, corpusId: pipeline.corpusId } },
    });

    if (!userCorpus) {
      throw new NotFoundException('Corpus no encontrado o sin acceso');
    }

    const tempDir = join(__dirname, '..', '..', '..', 'uploads');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const fileExt = file.originalname.substring(file.originalname.lastIndexOf('.'));
    const tempFilePath = join(tempDir, `temp_${Date.now()}${fileExt}`);
    writeFileSync(tempFilePath, file.buffer);

    let pythonOutput: any;
    try {
      pythonOutput = await this.runPythonIngestionWithPipeline(
        tempFilePath,
        {
          title: pipeline.name || file.originalname,
          author: pipeline.author,
          language: pipeline.language || 'SPANISH',
        },
        pipeline,
      );
    } catch (error: any) {
      throw new InternalServerErrorException(`Error en el preprocesamiento: ${error.message}`);
    }

    const wordCount = pythonOutput.word_count || 0;
    const tokenCount = pythonOutput.token_count || Math.ceil(wordCount * 1.3);
    const pageCount = pythonOutput.page_count || 0;

    const dataBuffer = Buffer.from(JSON.stringify(pythonOutput), 'utf-8');

    const document = await this.prisma.document.create({
      data: {
        corpusId: pipeline.corpusId,
        title: pipeline.name || file.originalname,
        description: pipeline.description || `Documento ingestado con pipeline: ${pipeline.name}`,
        author: pipeline.author || pythonOutput.author || 'Desconocido',
        documentType: pipeline.documentType || 'OTHER',
        language: pipeline.language || 'SPANISH',
        pageCount,
        tokenCount,
        content: dataBuffer,
      },
    });

    await this.prisma.documentAnalysis.create({
      data: {
        documentId: document.id,
        level0Status: 'APPROVED',
      },
    });

    await this.prisma.corpus.update({
      where: { id: pipeline.corpusId },
      data: {
        wordCount: { increment: wordCount },
      },
    });

    return {
      document,
      stats: {
        wordCount,
        tokenCount,
        pageCount,
        sentenceCount: pythonOutput.sentences?.length || 0,
        chapterCount: pythonOutput.chapters?.length || 0,
        footnoteCount: pythonOutput.footnotes?.length || 0,
      },
    };
  }

  private runPythonIngestionWithPipeline(
    tempFilePath: string,
    metadata: {
      title: string;
      author?: string;
      language?: Language;
    },
    pipeline: any,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'ingest.py');

      const pythonExe =
        process.platform === 'win32'
          ? join(__dirname, '..', '..', '..', 'venv', 'Scripts', 'python.exe')
          : join(__dirname, '..', '..', '..', 'venv', 'bin', 'python');

      const absolutePythonPath = existsSync(pythonExe) ? pythonExe : 'python';

      const args = [
        scriptPath,
        '--file',
        tempFilePath,
        '--title',
        metadata.title,
        '--language',
        metadata.language || 'SPANISH',
        '--inspect-pages',
        '2',
      ];

      if (metadata.author) {
        args.push('--author', metadata.author);
      }

      if (pipeline.customOptions) {
        try {
          const options = JSON.parse(pipeline.customOptions);
          if (options.maxPages) args.push('--max-pages', options.maxPages.toString());
          if (options.extractFigures) args.push('--extract-figures');
          if (options.extractTables) args.push('--extract-tables');
        } catch {
          this.logger.warn('Error al parsear customOptions del pipeline');
        }
      }

      this.logger.log(`[N0 Pipeline] Lanzando ingesta: ${absolutePythonPath} ${args.join(' ')}`);

      const env = {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      };

      const child = spawn(absolutePythonPath, args, { env });

      if (child.stdout) child.stdout.setEncoding('utf8');
      if (child.stderr) child.stderr.setEncoding('utf8');

      let stdoutData = '';
      let stderrBuffer = '';

      child.stdout.on('data', (data) => {
        stdoutData += data.toString('utf-8');
      });

      child.stderr.on('data', (data: string) => {
        stderrBuffer += data;
        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.replace(/\r/g, '');
          if (trimmed) {
            this.logger.log(`[N0 Pipeline] ${trimmed}`);
          }
        }
      });

      child.on('close', (code) => {
        if (stderrBuffer.trim()) {
          this.logger.log(`[N0 Pipeline] ${stderrBuffer.trim()}`);
        }

        if (code !== 0) {
          reject(new Error(`Python exit code ${code}.`));
        } else {
          try {
            const parsed = JSON.parse(stdoutData.trim());
            resolve(parsed);
          } catch (e: any) {
            reject(new Error(`Error al parsear salida Python: ${e.message}`));
          }
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  private runPythonIngestion(
    tempFilePath: string,
    metadata: {
      title: string;
      author?: string;
      language?: Language;
    },
    level0Config: Level0Config,
    onLog?: (line: string) => void,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const scriptPath = join(process.cwd(), 'scripts', 'ingest.py');

      const pythonExe =
        process.platform === 'win32'
          ? join(__dirname, '..', '..', '..', 'venv', 'Scripts', 'python.exe')
          : join(__dirname, '..', '..', '..', 'venv', 'bin', 'python');

      const absolutePythonPath = existsSync(pythonExe) ? pythonExe : 'python';

      const args = [
        scriptPath,
        '--file',
        tempFilePath,
        '--title',
        metadata.title,
        '--language',
        metadata.language || 'SPANISH',
        '--inspect-pages',
        '2',
        '--config-json',
        JSON.stringify(level0Config),
      ];

      if (metadata.author) {
        args.push('--author', metadata.author);
      }

      this.logger.log(`[N0] Lanzando ingesta: ${absolutePythonPath} ${args.join(' ')}`);

      const env = {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      };

      const child = spawn(absolutePythonPath, args, { env });

      if (child.stdout) child.stdout.setEncoding('utf8');
      if (child.stderr) child.stderr.setEncoding('utf8');

      let stdoutData = '';
      let stderrBuffer = '';

      child.stdout.on('data', (data) => {
        stdoutData += data.toString('utf-8');
      });

      child.stderr.on('data', (data: string) => {
        stderrBuffer += data;
        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.replace(/\r/g, '');
          if (trimmed) {
            this.logger.log(`[N0] ${trimmed}`);
            onLog?.(trimmed);
          }
        }
      });

      child.on('close', (code) => {
        if (stderrBuffer.trim()) {
          const finalLine = stderrBuffer.trim();
          this.logger.log(`[N0] ${finalLine}`);
          onLog?.(finalLine);
        }

        if (code !== 0) {
          reject(new Error(`Python exit code ${code}.`));
        } else {
          try {
            const parsed = JSON.parse(stdoutData.trim());
            resolve(parsed);
          } catch (e: any) {
            reject(
              new Error(
                `Error al parsear salida del script Python: ${e.message}. Raw output: ${stdoutData.substring(0, 500)}`,
              ),
            );
          }
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  async ingest(dto: IngestDocumentoDto, userId: string) {
    const corpus = await this.prisma.userCorpus.findUnique({
      where: { userId_corpusId: { userId, corpusId: dto.corpusId } },
    });
    if (!corpus) throw new NotFoundException('Corpus no encontrado o sin acceso');

    const cleanedContent = this.cleanText(dto.content);
    const wordCount = this.countWords(cleanedContent);
    const tokenCount = Math.ceil(wordCount * 1.3);

    const document = await this.prisma.document.create({
      data: {
        corpusId: dto.corpusId,
        title: dto.title,
        description: dto.description,
        author: dto.author,
        documentType: dto.documentType,
        language: dto.language,
        tokenCount,
      },
    });

    await this.prisma.documentAnalysis.create({
      data: {
        documentId: document.id,
        level0Status: 'APPROVED',
      },
    });

    await this.prisma.corpus.update({
      where: { id: dto.corpusId },
      data: {
        wordCount: { increment: wordCount },
      },
    });

    return {
      document,
      calculatedWordCount: wordCount,
    };
  }

  private cleanText(text: string): string {
    return text.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private countWords(text: string): number {
    if (!text) return 0;
    return text.split(/\s+/).filter((word) => word.length > 0).length;
  }
}
