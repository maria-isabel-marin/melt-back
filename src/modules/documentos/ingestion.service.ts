import { Injectable, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestDocumentoDto } from './dto/ingest-documento.dto';
import { Language, DocumentType } from '@prisma/client';
import { spawn } from 'child_process';
import { join } from 'path';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  constructor(private prisma: PrismaService) {}

  /**
   * Procesa e ingesta un documento usando el script Python del notebook N0.
   */
  async ingestFile(
    file: Express.Multer.File,
    metadata: {
      corpusId: string;
      title: string;
      author?: string;
      language?: Language;
      documentType?: DocumentType;
      description?: string;
    },
    userId: string,
  ) {
    // Verificar acceso al corpus
    const corpus = await this.prisma.userCorpus.findUnique({
      where: { userId_corpusId: { userId, corpusId: metadata.corpusId } },
    });
    if (!corpus) throw new NotFoundException('Corpus no encontrado o sin acceso');

    // 1. Guardar archivo temporalmente
    const tempDir = join(__dirname, '..', '..', '..', 'uploads');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // Usar el nombre original o uno seguro
    const fileExt = file.originalname.substring(file.originalname.lastIndexOf('.'));
    const tempFilePath = join(tempDir, `temp_${Date.now()}${fileExt}`);
    writeFileSync(tempFilePath, file.buffer);

    // 2. Ejecutar script de Python
    let pythonOutput: any;
    try {
      pythonOutput = await this.runPythonIngestion(tempFilePath, metadata);
    } catch (error: any) {
      // Limpiar archivo temporal en caso de error
      if (existsSync(tempFilePath)) unlinkSync(tempFilePath);
      throw new InternalServerErrorException(`Error en el preprocesamiento lingüístico: ${error.message}`);
    } finally {
      // Limpiar archivo temporal
      if (existsSync(tempFilePath)) {
        try {
          unlinkSync(tempFilePath);
        } catch (e) {
          // Ignorar
        }
      }
    }

    // 3. Crear el documento con los datos procesados y guardar JSON en 'content'
    const wordCount = pythonOutput.word_count || 0;
    const tokenCount = pythonOutput.token_count || Math.ceil(wordCount * 1.3);
    const pageCount = pythonOutput.page_count || 0;

    const dataBuffer = Buffer.from(JSON.stringify(pythonOutput), 'utf-8');

    const document = await this.prisma.document.create({
      data: {
        corpusId: metadata.corpusId,
        title: metadata.title,
        description: metadata.description || `Preprocesado de Nivel 0. Contiene ${pythonOutput.sentences?.length || 0} oraciones.`,
        author: metadata.author || pythonOutput.author || 'Desconocido',
        documentType: metadata.documentType || 'OTHER',
        language: metadata.language || 'SPANISH',
        pageCount: pageCount,
        tokenCount: tokenCount,
        content: dataBuffer,
      },
    });

    // Crear registro de análisis e inicializar Nivel 0 como APPROVED
    await this.prisma.documentAnalysis.create({
      data: {
        documentId: document.id,
        level0Status: 'APPROVED',
      },
    });

    // Actualizar el conteo total del corpus
    await this.prisma.corpus.update({
      where: { id: metadata.corpusId },
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

  /**
 * Procesa e ingesta un documento usando un pipeline específico.
 */
async ingestFileWithPipeline(
  file: Express.Multer.File,
  pipelineId: string,
  userId: string,
) {
  // 1. Verificar que el pipeline existe y pertenece al usuario
  const pipeline = await (this.prisma as any).pipeline.findUnique({
    where: { id: pipelineId },
    include: { corpus: { select: { userCorpusId: true } } },
  });

  if (!pipeline) {
    throw new NotFoundException('Pipeline de ingestión no encontrado');
  }

  // 2. Verificar que el usuario tiene acceso al corpus (igual que en ingestFile)
const userCorpus = await this.prisma.userCorpus.findUnique({
  where: { userId_corpusId: { userId, corpusId: pipeline.corpusId } },
});

if (!userCorpus) {
  throw new NotFoundException('Corpus no encontrado o sin acceso');
}

  // 3. Guardar archivo temporalmente
  const tempDir = join(__dirname, '..', '..', '..', 'uploads');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const fileExt = file.originalname.substring(file.originalname.lastIndexOf('.'));
  const tempFilePath = join(tempDir, `temp_${Date.now()}${fileExt}`);
  writeFileSync(tempFilePath, file.buffer);

  // 4. Ejecutar script de Python con configuración del pipeline
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
    if (existsSync(tempFilePath)) unlinkSync(tempFilePath);
    throw new InternalServerErrorException(`Error en el preprocesamiento: ${error.message}`);
  } finally {
    if (existsSync(tempFilePath)) {
      try {
        unlinkSync(tempFilePath);
      } catch (e) {
        // Ignorar
      }
    }
  }

  // 5. Crear el documento
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
      pageCount: pageCount,
      tokenCount: tokenCount,
      content: dataBuffer,
    },
  });

  // 6. Crear registro de análisis
  await this.prisma.documentAnalysis.create({
    data: {
      documentId: document.id,
      level0Status: 'APPROVED',
    },
  });

  // 7. Actualizar conteo del corpus
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

/**
 * Ejecuta el script Python con configuración específica del pipeline.
 */
private runPythonIngestionWithPipeline(
  tempFilePath: string,
  metadata: {
    title: string;
    author?: string;
    language?: Language;
  },
  pipeline: any, // DocumentIngestionPipeline
): Promise<any> {
  return new Promise((resolve, reject) => {
    const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'ingest.py');

    const pythonExe = process.platform === 'win32'
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

    // Agregar parámetros específicos del pipeline si es necesario
    if (pipeline.customOptions) {
      try {
        const options = JSON.parse(pipeline.customOptions);
        if (options.maxPages) args.push('--max-pages', options.maxPages.toString());
        if (options.extractFigures) args.push('--extract-figures');
        if (options.extractTables) args.push('--extract-tables');
      } catch (e) {
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

  /**
   * Ejecuta el script python y retorna el JSON parseado.
   */
  private runPythonIngestion(
    tempFilePath: string,
    metadata: {
      title: string;
      author?: string;
      language?: Language;
    },
  ): Promise<any> {
    return new Promise((resolve, reject) => {
     // const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'ingest.py');
      const scriptPath = join(process.cwd(), 'scripts', 'ingest.py');

      // Determinar ejecutable de Python del entorno virtual
      const pythonExe = process.platform === 'win32'
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
        '2',   // Mostrar 2 páginas de muestra en el paso 3C
      ];

      if (metadata.author) {
        args.push('--author', metadata.author);
      }

      this.logger.log(`[N0] Lanzando ingesta: ${absolutePythonPath} ${args.join(' ')}`);

      //const child = spawn(absolutePythonPath, args);

      const env = {
      ...process.env,
      PYTHONUTF8: '1',              // Forzar UTF-8 en Windows
      PYTHONIOENCODING: 'utf-8',    // Forzar codificación de I/O
      };

      const child = spawn(absolutePythonPath, args, {
        env, // 🔧 Pasar variables de entorno
      });

      // Establecer encoding en los streams stdout/stderr
      if (child.stdout) child.stdout.setEncoding('utf8');
      if (child.stderr) child.stderr.setEncoding('utf8');

      let stdoutData = '';
      let stderrBuffer = '';  // Buffer para líneas incompletas

      child.stdout.on('data', (data) => {
        stdoutData += data.toString('utf-8');
      });

      // Transmitir stderr línea por línea al logger de NestJS en tiempo real
      child.stderr.on('data', (data: string) => {
        stderrBuffer += data;
        const lines = stderrBuffer.split('\n');
        // Guardar la última línea (puede estar incompleta)
        stderrBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.replace(/\r/g, '');
          if (trimmed) {
            this.logger.log(`[N0] ${trimmed}`);
          }
        }
      });

      child.on('close', (code) => {
        // Volcar cualquier resto del buffer stderr
        if (stderrBuffer.trim()) {
          this.logger.log(`[N0] ${stderrBuffer.trim()}`);
        }
        if (code !== 0) {
          reject(new Error(`Python exit code ${code}.`));
        } else {
          try {
            const parsed = JSON.parse(stdoutData.trim());
            resolve(parsed);
          } catch (e: any) {
            reject(new Error(`Error al parsear salida del script Python: ${e.message}. Raw output: ${stdoutData.substring(0, 500)}`));
          }
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Endpoint anterior de ingesta básica de texto (se conserva por compatibilidad).
   */
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
        tokenCount: tokenCount,
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
    return text
      .replace(/\r?\n|\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private countWords(text: string): number {
    if (!text) return 0;
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }
}
