import { Injectable } from '@nestjs/common';

export type Level0ProgressStatus = 'IDLE' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type Level0StepStatus = 'pending' | 'processing' | 'done' | 'error';

export interface Level0ProgressStep {
  key: string;
  label: string;
  status: Level0StepStatus;
  message?: string;
}

export interface Level0ProgressState {
  documentId: string;
  status: Level0ProgressStatus;
  progress: number;
  message?: string;
  error?: string;
  startedAt?: string;
  updatedAt?: string;
  steps: Level0ProgressStep[];
}

@Injectable()
export class Level0ProgressService {
  private readonly store = new Map<string, Level0ProgressState>();

  private buildSteps(): Level0ProgressStep[] {
    return [
      { key: 'extract', label: 'Extract text', status: 'pending' },
      { key: 'chapters', label: 'Detect chapters', status: 'pending' },
      { key: 'clean', label: 'Clean text', status: 'pending' },
      { key: 'segment', label: 'Segment sentences', status: 'pending' },
      { key: 'nlp', label: 'Run linguistic preprocessing', status: 'pending' },
      { key: 'save', label: 'Save processed data', status: 'pending' },
    ];
  }

  init(documentId: string) {
    const now = new Date().toISOString();
    const state: Level0ProgressState = {
      documentId,
      status: 'PROCESSING',
      progress: 3,
      message: 'Starting Level 0 processing...',
      startedAt: now,
      updatedAt: now,
      steps: this.buildSteps(),
    };
    this.store.set(documentId, state);
    return state;
  }

  get(documentId: string): Level0ProgressState {
    return (
      this.store.get(documentId) ?? {
        documentId,
        status: 'IDLE',
        progress: 0,
        steps: this.buildSteps(),
      }
    );
  }

  startStep(documentId: string, key: string, message?: string) {
    const state = this.get(documentId);
    const steps = state.steps.map((step) =>
      step.key === key
        ? { ...step, status: 'processing' as const, message }
        : step
    );

    const stepIndex = steps.findIndex((s) => s.key === key);
    const progress = Math.max(5, Math.round((stepIndex / steps.length) * 100));

    this.store.set(documentId, {
      ...state,
      status: 'PROCESSING',
      progress,
      message: message ?? state.message,
      updatedAt: new Date().toISOString(),
      steps,
    });
  }

  finishStep(documentId: string, key: string, message?: string) {
    const state = this.get(documentId);
    const steps = state.steps.map((step) =>
      step.key === key
        ? { ...step, status: 'done' as const, message }
        : step
    );

    const doneCount = steps.filter((s) => s.status === 'done').length;
    const progress = Math.min(95, Math.round((doneCount / steps.length) * 100));

    this.store.set(documentId, {
      ...state,
      status: 'PROCESSING',
      progress,
      message: message ?? state.message,
      updatedAt: new Date().toISOString(),
      steps,
    });
  }

  fail(documentId: string, key: string | null, error: string) {
    const state = this.get(documentId);
    const steps = state.steps.map((step) =>
      key && step.key === key
        ? { ...step, status: 'error' as const, message: error }
        : step
    );

    this.store.set(documentId, {
      ...state,
      status: 'FAILED',
      error,
      message: error,
      updatedAt: new Date().toISOString(),
      steps,
    });
  }

  complete(documentId: string, message = 'Level 0 processing completed.') {
    const state = this.get(documentId);
    const steps = state.steps.map((step) =>
      step.status === 'pending'
        ? { ...step, status: 'done' as const }
        : step
    );

    this.store.set(documentId, {
      ...state,
      status: 'COMPLETED',
      progress: 100,
      message,
      updatedAt: new Date().toISOString(),
      steps,
    });
  }

  reset(documentId: string) {
    this.store.delete(documentId);
  }
}