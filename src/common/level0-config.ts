export type Level0ChapterDetectionMethod =
  | 'AUTO'
  | 'TOC'
  | 'PRINTED_INDEX'
  | 'FONT_SIZE'
  | 'NONE';

export interface Level0Config {
  chapterDetection: {
    enabled: boolean;
    method: Level0ChapterDetectionMethod;
  };
  cleaning: {
    repairHyphenation: boolean;
    detectRepeatedHeaders: boolean;
    repeatedHeaderThreshold: number;
    excludeFrontMatter: boolean;
    minLineLength: number;
    additionalHeadersFooters: string[];
  };
  footnotes: {
    extract: boolean;
  };
  segmentation: {
    minChars: number;
    maxChars: number;
  };
  excludedPageRanges: Array<[number, number]> | null;
}

export interface Level0ConfigOverrides {
  chapterDetection?: Partial<Level0Config['chapterDetection']>;
  cleaning?: Partial<Level0Config['cleaning']>;
  footnotes?: Partial<Level0Config['footnotes']>;
  segmentation?: Partial<Level0Config['segmentation']>;
  excludedPageRanges?: Array<[number, number]> | null;
}

export const DEFAULT_LEVEL0_CONFIG: Level0Config = {
  chapterDetection: {
    enabled: true,
    method: 'AUTO',
  },
  cleaning: {
    repairHyphenation: true,
    detectRepeatedHeaders: true,
    repeatedHeaderThreshold: 0.3,
    excludeFrontMatter: true,
    minLineLength: 30,
    additionalHeadersFooters: [],
  },
  footnotes: {
    extract: true,
  },
  segmentation: {
    minChars: 10,
    maxChars: 2000,
  },
  // null preserves the current filename-specific exclusions in ingest.py.
  // A document override of [] explicitly disables those legacy exclusions.
  excludedPageRanges: null,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asFiniteNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numberValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

function asInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.round(asFiniteNumber(value, fallback, min, max));
}

function sanitizeMethod(
  value: unknown,
  fallback: Level0ChapterDetectionMethod,
): Level0ChapterDetectionMethod {
  const allowed: Level0ChapterDetectionMethod[] = [
    'AUTO',
    'TOC',
    'PRINTED_INDEX',
    'FONT_SIZE',
    'NONE',
  ];

  return typeof value === 'string' &&
    allowed.includes(value as Level0ChapterDetectionMethod)
    ? (value as Level0ChapterDetectionMethod)
    : fallback;
}

function sanitizeHeaders(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const clean = item.replace(/\s+/g, ' ').trim().slice(0, 250);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
    if (result.length >= 250) break;
  }

  return result;
}

function sanitizePageRanges(
  value: unknown,
  fallback: Array<[number, number]> | null,
): Array<[number, number]> | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return fallback;

  const result: Array<[number, number]> = [];

  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) continue;

    const start = Math.max(1, Math.round(Number(item[0])));
    const end = Math.max(1, Math.round(Number(item[1])));

    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    result.push(start <= end ? [start, end] : [end, start]);
    if (result.length >= 250) break;
  }

  return result;
}

export function sanitizeLevel0Overrides(
  value: unknown,
): Level0ConfigOverrides {
  if (!isObject(value)) return {};

  const result: Level0ConfigOverrides = {};

  if (isObject(value.chapterDetection)) {
    result.chapterDetection = {};

    if ('enabled' in value.chapterDetection) {
      result.chapterDetection.enabled = asBoolean(
        value.chapterDetection.enabled,
        DEFAULT_LEVEL0_CONFIG.chapterDetection.enabled,
      );
    }

    if ('method' in value.chapterDetection) {
      result.chapterDetection.method = sanitizeMethod(
        value.chapterDetection.method,
        DEFAULT_LEVEL0_CONFIG.chapterDetection.method,
      );
    }
  }

  if (isObject(value.cleaning)) {
    result.cleaning = {};

    if ('repairHyphenation' in value.cleaning) {
      result.cleaning.repairHyphenation = asBoolean(
        value.cleaning.repairHyphenation,
        DEFAULT_LEVEL0_CONFIG.cleaning.repairHyphenation,
      );
    }

    if ('detectRepeatedHeaders' in value.cleaning) {
      result.cleaning.detectRepeatedHeaders = asBoolean(
        value.cleaning.detectRepeatedHeaders,
        DEFAULT_LEVEL0_CONFIG.cleaning.detectRepeatedHeaders,
      );
    }

    if ('repeatedHeaderThreshold' in value.cleaning) {
      result.cleaning.repeatedHeaderThreshold = asFiniteNumber(
        value.cleaning.repeatedHeaderThreshold,
        DEFAULT_LEVEL0_CONFIG.cleaning.repeatedHeaderThreshold,
        0.05,
        0.95,
      );
    }

    if ('excludeFrontMatter' in value.cleaning) {
      result.cleaning.excludeFrontMatter = asBoolean(
        value.cleaning.excludeFrontMatter,
        DEFAULT_LEVEL0_CONFIG.cleaning.excludeFrontMatter,
      );
    }

    if ('minLineLength' in value.cleaning) {
      result.cleaning.minLineLength = asInteger(
        value.cleaning.minLineLength,
        DEFAULT_LEVEL0_CONFIG.cleaning.minLineLength,
        0,
        500,
      );
    }

    if ('additionalHeadersFooters' in value.cleaning) {
      result.cleaning.additionalHeadersFooters = sanitizeHeaders(
        value.cleaning.additionalHeadersFooters,
      );
    }
  }

  if (isObject(value.footnotes)) {
    result.footnotes = {};

    if ('extract' in value.footnotes) {
      result.footnotes.extract = asBoolean(
        value.footnotes.extract,
        DEFAULT_LEVEL0_CONFIG.footnotes.extract,
      );
    }
  }

  if (isObject(value.segmentation)) {
    result.segmentation = {};

    if ('minChars' in value.segmentation) {
      result.segmentation.minChars = asInteger(
        value.segmentation.minChars,
        DEFAULT_LEVEL0_CONFIG.segmentation.minChars,
        1,
        5000,
      );
    }

    if ('maxChars' in value.segmentation) {
      result.segmentation.maxChars = asInteger(
        value.segmentation.maxChars,
        DEFAULT_LEVEL0_CONFIG.segmentation.maxChars,
        2,
        20000,
      );
    }
  }

  if ('excludedPageRanges' in value) {
    result.excludedPageRanges = sanitizePageRanges(
      value.excludedPageRanges,
      DEFAULT_LEVEL0_CONFIG.excludedPageRanges,
    );
  }

  return result;
}

function applyOverrides(
  base: Level0Config,
  overrides: Level0ConfigOverrides,
): Level0Config {
  const minChars =
    overrides.segmentation?.minChars ?? base.segmentation.minChars;

  let maxChars =
    overrides.segmentation?.maxChars ?? base.segmentation.maxChars;

  if (maxChars < minChars) {
    maxChars = minChars;
  }

  return {
    chapterDetection: {
      ...base.chapterDetection,
      ...(overrides.chapterDetection ?? {}),
    },
    cleaning: {
      ...base.cleaning,
      ...(overrides.cleaning ?? {}),
      additionalHeadersFooters:
        overrides.cleaning?.additionalHeadersFooters ??
        base.cleaning.additionalHeadersFooters,
    },
    footnotes: {
      ...base.footnotes,
      ...(overrides.footnotes ?? {}),
    },
    segmentation: {
      minChars,
      maxChars,
    },
    excludedPageRanges:
      'excludedPageRanges' in overrides
        ? (overrides.excludedPageRanges ?? null)
        : base.excludedPageRanges,
  };
}

export function resolveLevel0Config(
  corpusConfig: unknown,
  documentOverrides: unknown,
): Level0Config {
  const fromDefaults = applyOverrides(
    DEFAULT_LEVEL0_CONFIG,
    sanitizeLevel0Overrides(corpusConfig),
  );

  return applyOverrides(
    fromDefaults,
    sanitizeLevel0Overrides(documentOverrides),
  );
}

export function normalizeCorpusLevel0Config(value: unknown): Level0Config {
  return resolveLevel0Config(value, null);
}

export function normalizeDocumentLevel0Overrides(
  value: unknown,
): Level0ConfigOverrides {
  return sanitizeLevel0Overrides(value);
}
