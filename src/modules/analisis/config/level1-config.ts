export type Level1Approach = 'CLAUDE' | 'OPENAI';

export type Level1SentenceMode = 'ALL' | 'LIMITED';

export type Level1SentenceSelectionStrategy =
  | 'RANDOM'
  | 'DISTRIBUTED'
  | 'FIRST'
  | 'BY_CHAPTER';

export interface Level1Config {
  approaches: Level1Approach[];

  sentenceSelection: {
    mode: Level1SentenceMode;
    maxSentences: number | null;
    strategy: Level1SentenceSelectionStrategy;
    randomSeed: number;
  };

  // Extensión técnica de MELT para reducir el número de requests.
  batchSize: number;

  output: {
    ontologicalMappings: boolean;
    epistemicMappings: boolean;
  };
}

export type Level1ConfigOverrides = {
  approaches?: Level1Approach[];
  sentenceSelection?: Partial<Level1Config['sentenceSelection']>;
  batchSize?: number;
  output?: Partial<Level1Config['output']>;
};

export const DEFAULT_LEVEL1_CONFIG: Level1Config = {
  // Equivale a ENFOQUES_ACTIVOS = ["claude", "openai"] del notebook.
  approaches: ['CLAUDE', 'OPENAI'],

  sentenceSelection: {
    mode: 'ALL',
    maxSentences: null,
    // Cuando se limita, RANDOM replica la idea de df.sample(random_state=42).
    strategy: 'RANDOM',
    randomSeed: 42,
  },

  batchSize: 10,

  output: {
    ontologicalMappings: true,
    epistemicMappings: true,
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  const integerValue = Math.round(numericValue);
  return Math.min(maximum, Math.max(minimum, integerValue));
}

function normalizeMode(value: unknown): Level1SentenceMode {
  return value === 'LIMITED' ? 'LIMITED' : 'ALL';
}

function normalizeStrategy(value: unknown): Level1SentenceSelectionStrategy {
  if (
    value === 'RANDOM' ||
    value === 'DISTRIBUTED' ||
    value === 'FIRST' ||
    value === 'BY_CHAPTER'
  ) {
    return value;
  }
  return 'RANDOM';
}

function normalizeApproaches(value: unknown): Level1Approach[] {
  if (!Array.isArray(value)) return [...DEFAULT_LEVEL1_CONFIG.approaches];

  const normalized = value
    .map((item) => String(item).trim().toUpperCase())
    .filter(
      (item): item is Level1Approach => item === 'CLAUDE' || item === 'OPENAI',
    );

  return [...new Set(normalized)];
}

export function normalizeLevel1Config(value: unknown): Level1Config {
  const source = isObject(value) ? value : {};
  const sentenceSelection = isObject(source.sentenceSelection)
    ? source.sentenceSelection
    : {};
  const output = isObject(source.output) ? source.output : {};

  const mode = normalizeMode(sentenceSelection.mode);
  const approaches = normalizeApproaches(source.approaches);

  let maxSentences: number | null = null;
  if (mode === 'LIMITED') {
    maxSentences = normalizeInteger(
      sentenceSelection.maxSentences,
      50,
      1,
      100000,
    );
  }

  return {
    approaches:
      approaches.length > 0 ? approaches : [...DEFAULT_LEVEL1_CONFIG.approaches],

    sentenceSelection: {
      mode,
      maxSentences,
      strategy: normalizeStrategy(sentenceSelection.strategy),
      randomSeed: normalizeInteger(
        sentenceSelection.randomSeed,
        42,
        0,
        2147483647,
      ),
    },

    batchSize: normalizeInteger(
      source.batchSize,
      DEFAULT_LEVEL1_CONFIG.batchSize,
      1,
      100,
    ),

    output: {
      ontologicalMappings:
        typeof output.ontologicalMappings === 'boolean'
          ? output.ontologicalMappings
          : DEFAULT_LEVEL1_CONFIG.output.ontologicalMappings,
      epistemicMappings:
        typeof output.epistemicMappings === 'boolean'
          ? output.epistemicMappings
          : DEFAULT_LEVEL1_CONFIG.output.epistemicMappings,
    },
  };
}

export function resolveLevel1Config(
  corpusConfig: unknown,
  documentOverrides: unknown,
): Level1Config {
  const corpusResolved = normalizeLevel1Config(corpusConfig);
  if (!isObject(documentOverrides)) return corpusResolved;

  const sentenceOverrides = isObject(documentOverrides.sentenceSelection)
    ? documentOverrides.sentenceSelection
    : {};
  const outputOverrides = isObject(documentOverrides.output)
    ? documentOverrides.output
    : {};

  return normalizeLevel1Config({
    ...corpusResolved,
    ...(documentOverrides.approaches !== undefined
      ? { approaches: documentOverrides.approaches }
      : {}),
    sentenceSelection: {
      ...corpusResolved.sentenceSelection,
      ...sentenceOverrides,
    },
    batchSize: documentOverrides.batchSize ?? corpusResolved.batchSize,
    output: {
      ...corpusResolved.output,
      ...outputOverrides,
    },
  });
}

export function normalizeDocumentLevel1Overrides(
  value: unknown,
): Level1ConfigOverrides | null {
  if (!isObject(value)) return null;

  const result: Level1ConfigOverrides = {};

  if (value.approaches !== undefined) {
    const approaches = normalizeApproaches(value.approaches);
    if (approaches.length > 0) result.approaches = approaches;
  }

  if (isObject(value.sentenceSelection)) {
    result.sentenceSelection = {
      ...(value.sentenceSelection.mode !== undefined
        ? { mode: normalizeMode(value.sentenceSelection.mode) }
        : {}),
      ...(value.sentenceSelection.maxSentences !== undefined
        ? {
            maxSentences:
              value.sentenceSelection.maxSentences === null
                ? null
                : normalizeInteger(
                    value.sentenceSelection.maxSentences,
                    50,
                    1,
                    100000,
                  ),
          }
        : {}),
      ...(value.sentenceSelection.strategy !== undefined
        ? { strategy: normalizeStrategy(value.sentenceSelection.strategy) }
        : {}),
      ...(value.sentenceSelection.randomSeed !== undefined
        ? {
            randomSeed: normalizeInteger(
              value.sentenceSelection.randomSeed,
              42,
              0,
              2147483647,
            ),
          }
        : {}),
    };
  }

  if (value.batchSize !== undefined) {
    result.batchSize = normalizeInteger(
      value.batchSize,
      DEFAULT_LEVEL1_CONFIG.batchSize,
      1,
      100,
    );
  }

  if (isObject(value.output)) {
    result.output = {
      ...(typeof value.output.ontologicalMappings === 'boolean'
        ? { ontologicalMappings: value.output.ontologicalMappings }
        : {}),
      ...(typeof value.output.epistemicMappings === 'boolean'
        ? { epistemicMappings: value.output.epistemicMappings }
        : {}),
    };
  }

  return result;
}
