import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { join } from 'path';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Servicio para ejecutar scripts de Python del pipeline
 */
@Injectable()
export class PipelineProcessorService {
  private readonly logger = new Logger(PipelineProcessorService.name);

  /**
   * Ejecuta step1_extract.py (extracción de texto y detección de capítulos)
   */
  async runStep1Extract(
    filePath: string,
    title: string,
    language: string = 'SPANISH'
  ): Promise<any> {
    return this.runPythonScript('step1_extract.py', [
      '--file',
      filePath,
      '--title',
      title,
      '--language',
      language,
    ]);
  }

  /**
   * Ejecuta step2_clean.py (limpieza de texto)
   */
  async runStep2Clean(step1JsonPath: string, originalFile: string): Promise<any> {
    return this.runPythonScript('step2_clean.py', [
      '--step1-json',
      step1JsonPath,
      '--original-file',
      originalFile,
    ]);
  }

  /**
   * Ejecuta step4_segment.py (segmentación en oraciones)
   */
  async runStep4Segment(
    step2JsonPath: string,
    language: string = 'SPANISH',
    title?: string
  ): Promise<any> {
    const args = ['--step2-json', step2JsonPath, '--language', language];
    if (title) {
      args.push('--title', title);
    }
    return this.runPythonScript('step4_segment.py', args);
  }

  /**
   * Ejecuta step5_nlp.py (preprocesamiento lingüístico)
   */
  async runStep5Nlp(
    step4JsonPath: string,
    language: string = 'SPANISH'
  ): Promise<any> {
    return this.runPythonScript('step5_nlp.py', [
      '--step4-json',
      step4JsonPath,
      '--language',
      language,
    ]);
  }

  /**
   * Ejecuta step6_generate.py (generación del DataFrame N0)
   */
  async runStep6Generate(
    step5JsonPath: string,
    title?: string,
    author?: string
  ): Promise<any> {
    const args = ['--step5-json', step5JsonPath];
    if (title) args.push('--title', title);
    if (author) args.push('--author', author);
    return this.runPythonScript('step6_generate.py', args);
  }

  /**
   * Ejecuta un script Python genérico y parsea su salida JSON
   */
  private runPythonScript(scriptName: string, args: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const scriptPath = join(__dirname, '..', '..', '..', 'scripts', scriptName);

      const pythonExe = process.platform === 'win32'
        ? join(__dirname, '..', '..', '..', 'venv', 'Scripts', 'python.exe')
        : join(__dirname, '..', '..', '..', 'venv', 'bin', 'python');

      const absolutePythonPath = fs.existsSync(pythonExe) ? pythonExe : 'python';

      this.logger.debug(`Ejecutando: ${absolutePythonPath} ${scriptPath} ${args.join(' ')}`);

      const env = {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      };

      const child = spawn(absolutePythonPath, [scriptPath, ...args], { env });

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
            this.logger.log(`[Python] ${trimmed}`);
          }
        }
      });

      child.on('close', (code) => {
        if (stderrBuffer.trim()) {
          this.logger.log(`[Python] ${stderrBuffer.trim()}`);
        }
        if (code !== 0) {
          reject(new Error(`Python exit code ${code}`));
        } else {
          try {
            const parsed = JSON.parse(stdoutData.trim());
            resolve(parsed);
          } catch (e: any) {
            reject(
              new Error(
                `Error al parsear salida JSON: ${e.message}. Raw: ${stdoutData.substring(0, 200)}`
              )
            );
          }
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }
}
