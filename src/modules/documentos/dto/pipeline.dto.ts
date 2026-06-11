/**
 * DTO para el inicio de una pipeline de ingesta
 */
export class PipelineProgressDto {
  pipelineId: string;
  currentStep: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress: {
    [step: number]: {
      status: 'pending' | 'in_progress' | 'completed' | 'failed';
      progress: number;
      error?: string;
    };
  };
  error?: string;
  metadata: {
    filename: string;
    title: string;
    language: string;
    uploadedAt: Date;
  };
}

/**
 * DTO para el resultado final de la pipeline
 */
export class PipelineResultDto {
  pipelineId: string;
  documentId: string;
  status: 'completed' | 'failed';
  result?: any;
  error?: string;
}

/**
 * DTO para solicitar el siguiente paso
 */
export class PipelineNextStepDto {
  step: number;
  progress: number;
  data?: any;
}
