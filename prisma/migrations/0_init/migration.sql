-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AffectType" AS ENUM ('FACILITATED', 'INHIBITED');

-- CreateEnum
CREATE TYPE "public"."AiProvider" AS ENUM ('CLAUDE', 'OPENAI', 'HUGGINGFACE');

-- CreateEnum
CREATE TYPE "public"."ConventionalizationApproach" AS ENUM ('FREQUENCY', 'THEMATIC_CLUSTER');

-- CreateEnum
CREATE TYPE "public"."ConventionalizationRobustness" AS ENUM ('HIGH', 'MODERATE', 'WEAK');

-- CreateEnum
CREATE TYPE "public"."DocumentType" AS ENUM ('ACADEMIC_ARTICLE', 'POLITICAL_SPEECH', 'NEWS', 'EDITORIAL', 'INTERVIEW', 'OFFICIAL_DOCUMENT', 'SOCIAL_MEDIA', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."InferenceType" AS ENUM ('CAUSAL', 'TEMPORAL', 'CONDITIONAL', 'NORMATIVE', 'EVALUATIVE');

-- CreateEnum
CREATE TYPE "public"."ItemStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'MODIFIED');

-- CreateEnum
CREATE TYPE "public"."Language" AS ENUM ('SPANISH', 'ENGLISH');

-- CreateEnum
CREATE TYPE "public"."LevelStatus" AS ENUM ('PENDING', 'PROCESSING', 'PENDING_REVIEW', 'APPROVED', 'OUTDATED');

-- CreateEnum
CREATE TYPE "public"."ScenarioStatus" AS ENUM ('DOMINANT', 'CHALLENGER', 'EMERGING', 'PERIPHERAL');

-- CreateEnum
CREATE TYPE "public"."SequenceType" AS ENUM ('TEMPORAL', 'CAUSAL');

-- CreateEnum
CREATE TYPE "public"."UsageValuation" AS ENUM ('POSITIVE', 'NEGATIVE', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "public"."UserCorpusRole" AS ENUM ('OWNER', 'COLLABORATOR', 'VIEWER');

-- CreateTable
CREATE TABLE "public"."affects" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "affectType" "public"."AffectType" NOT NULL,
    "affectName" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "socialFunction" TEXT,
    "linguisticMarkers" TEXT,
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."consolidated_analyses" (
    "id" TEXT NOT NULL,
    "corpusId" TEXT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "documentIds" TEXT[],
    "aiProvider" "public"."AiProvider" NOT NULL DEFAULT 'CLAUDE',
    "level2Status" "public"."LevelStatus" NOT NULL DEFAULT 'PENDING',
    "level3Status" "public"."LevelStatus" NOT NULL DEFAULT 'PENDING',
    "level4Status" "public"."LevelStatus" NOT NULL DEFAULT 'PENDING',
    "level5Status" "public"."LevelStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consolidated_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."consolidated_conventional_metaphors" (
    "id" TEXT NOT NULL,
    "consolidatedAnalysisId" TEXT NOT NULL,
    "conceptualMetaphor" VARCHAR(500) NOT NULL,
    "sourceDomain" VARCHAR(200) NOT NULL,
    "targetDomain" VARCHAR(200) NOT NULL,
    "approach" "public"."ConventionalizationApproach" NOT NULL,
    "absoluteFrequency" INTEGER NOT NULL DEFAULT 0,
    "textualDistribution" JSONB,
    "robustness" "public"."ConventionalizationRobustness" NOT NULL,
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidated_conventional_metaphors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."consolidated_narratives" (
    "id" TEXT NOT NULL,
    "consolidatedAnalysisId" TEXT NOT NULL,
    "consolidatedRegimeId" TEXT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "description" VARCHAR(1000),
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidated_narratives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."consolidated_regime_scenarios" (
    "consolidatedRegimeId" TEXT NOT NULL,
    "consolidatedScenarioId" TEXT NOT NULL,

    CONSTRAINT "consolidated_regime_scenarios_pkey" PRIMARY KEY ("consolidatedRegimeId","consolidatedScenarioId")
);

-- CreateTable
CREATE TABLE "public"."consolidated_regimes" (
    "id" TEXT NOT NULL,
    "consolidatedAnalysisId" TEXT NOT NULL,
    "regimeName" VARCHAR(300) NOT NULL,
    "aggregateFrequency" INTEGER NOT NULL DEFAULT 0,
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidated_regimes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."consolidated_scenarios" (
    "id" TEXT NOT NULL,
    "consolidatedAnalysisId" TEXT NOT NULL,
    "consolidatedConventionalMetaphorId" TEXT NOT NULL,
    "scenarioName" VARCHAR(200) NOT NULL,
    "status" "public"."ScenarioStatus" NOT NULL,
    "usageValuation" "public"."UsageValuation" NOT NULL,
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidated_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conventional_metaphors" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "conceptualMetaphor" VARCHAR(500) NOT NULL,
    "sourceDomain" VARCHAR(200) NOT NULL,
    "targetDomain" VARCHAR(200) NOT NULL,
    "approach" "public"."ConventionalizationApproach" NOT NULL,
    "absoluteFrequency" INTEGER NOT NULL DEFAULT 0,
    "textualDistribution" JSONB,
    "robustness" "public"."ConventionalizationRobustness" NOT NULL,
    "usageContext" TEXT,
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conventional_metaphors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."corpus" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "wordCount" INTEGER,
    "discursiveCommunity" VARCHAR(200),
    "textualGenre" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corpus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cultural_narratives" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "regimeId" TEXT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "description" VARCHAR(1000),
    "textualDistribution" TEXT[],
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cultural_narratives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_analyses" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "aiProvider" "public"."AiProvider" NOT NULL DEFAULT 'CLAUDE',
    "level0Status" "public"."LevelStatus" NOT NULL DEFAULT 'PENDING',
    "level1Status" "public"."LevelStatus" NOT NULL DEFAULT 'PENDING',
    "level2Status" "public"."LevelStatus" NOT NULL DEFAULT 'PENDING',
    "level3Status" "public"."LevelStatus" NOT NULL DEFAULT 'PENDING',
    "level4Status" "public"."LevelStatus" NOT NULL DEFAULT 'PENDING',
    "level5Status" "public"."LevelStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_ingestion_pipelines" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "corpusId" TEXT NOT NULL,
    "author" TEXT,
    "language" "public"."Language",
    "documentType" "public"."DocumentType",
    "customOptions" JSONB,

    CONSTRAINT "document_ingestion_pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."documents" (
    "id" TEXT NOT NULL,
    "corpusId" TEXT NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3),
    "author" VARCHAR(200),
    "documentType" "public"."DocumentType",
    "language" "public"."Language" NOT NULL DEFAULT 'SPANISH',
    "content" BYTEA,
    "pageCount" INTEGER,
    "tokenCount" INTEGER,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."epistemic_mappings" (
    "id" TEXT NOT NULL,
    "primaryMetaphorId" TEXT NOT NULL,
    "sourceRelation" VARCHAR(300) NOT NULL,
    "targetInference" VARCHAR(300) NOT NULL,
    "inferenceType" "public"."InferenceType" NOT NULL,
    "textualEvidence" TEXT,
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "epistemic_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."evaluative_biases" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "positive" TEXT[],
    "negative" TEXT[],
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluative_biases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."metaphor_regimes" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "regimeName" VARCHAR(300) NOT NULL,
    "aggregateFrequency" INTEGER NOT NULL DEFAULT 0,
    "metaphors" TEXT[],
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metaphor_regimes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."metaphorical_scenarios" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "conventionalMetaphorId" TEXT NOT NULL,
    "scenarioName" VARCHAR(200) NOT NULL,
    "mappingIds" TEXT[],
    "status" "public"."ScenarioStatus" NOT NULL,
    "usageValuation" "public"."UsageValuation" NOT NULL,
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metaphorical_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."narrative_sequences" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "act1Beginning" TEXT NOT NULL,
    "act2Development" TEXT NOT NULL,
    "act3Resolution" TEXT NOT NULL,
    "sequenceType" "public"."SequenceType" NOT NULL,
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "narrative_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ontological_mappings" (
    "id" TEXT NOT NULL,
    "primaryMetaphorId" TEXT NOT NULL,
    "sourceElement" VARCHAR(200) NOT NULL,
    "targetElement" VARCHAR(200) NOT NULL,
    "textualEvidence" TEXT,
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ontological_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."positioned_social_groups" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "socialGroup" VARCHAR(200) NOT NULL,
    "legitimizedActions" TEXT[],
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "positioned_social_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."primary_metaphor_conventional" (
    "conventionalMetaphorId" TEXT NOT NULL,
    "primaryMetaphorId" TEXT NOT NULL,

    CONSTRAINT "primary_metaphor_conventional_pkey" PRIMARY KEY ("conventionalMetaphorId","primaryMetaphorId")
);

-- CreateTable
CREATE TABLE "public"."primary_metaphors" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "page" INTEGER,
    "metaphoricalExpression" VARCHAR(500) NOT NULL,
    "context" TEXT,
    "focus" VARCHAR(100),
    "focusLemma" VARCHAR(100),
    "focusPartOfSpeech" VARCHAR(100),
    "contextualMeaning" VARCHAR(500),
    "basicMeaning" VARCHAR(500),
    "sourceDomain" VARCHAR(200),
    "targetDomain" VARCHAR(200),
    "conceptualMetaphor" VARCHAR(500),
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "primary_metaphors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."regime_derived_metaphors" (
    "id" TEXT NOT NULL,
    "regimeId" TEXT NOT NULL,
    "derivedMetaphor" TEXT NOT NULL,
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regime_derived_metaphors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."scenario_regimes" (
    "regimeId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,

    CONSTRAINT "scenario_regimes_pkey" PRIMARY KEY ("regimeId","scenarioId")
);

-- CreateTable
CREATE TABLE "public"."user_corpus" (
    "userId" TEXT NOT NULL,
    "corpusId" TEXT NOT NULL,
    "role" "public"."UserCorpusRole" NOT NULL DEFAULT 'OWNER',

    CONSTRAINT "user_corpus_pkey" PRIMARY KEY ("userId","corpusId")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "googleId" TEXT,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."value_axes" (
    "id" TEXT NOT NULL,
    "regimeId" TEXT NOT NULL,
    "axisName" VARCHAR(200) NOT NULL,
    "positivePolarity" TEXT[],
    "negativePolarity" TEXT[],
    "evidence" TEXT,
    "itemStatus" "public"."ItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "analystNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "value_axes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consolidated_narratives_consolidatedAnalysisId_key" ON "public"."consolidated_narratives"("consolidatedAnalysisId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "consolidated_narratives_consolidatedRegimeId_key" ON "public"."consolidated_narratives"("consolidatedRegimeId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cultural_narratives_analysisId_key" ON "public"."cultural_narratives"("analysisId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cultural_narratives_regimeId_key" ON "public"."cultural_narratives"("regimeId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_analyses_documentId_key" ON "public"."document_analyses"("documentId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "evaluative_biases_scenarioId_key" ON "public"."evaluative_biases"("scenarioId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "narrative_sequences_scenarioId_key" ON "public"."narrative_sequences"("scenarioId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "public"."users"("googleId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "value_axes_regimeId_key" ON "public"."value_axes"("regimeId" ASC);

-- AddForeignKey
ALTER TABLE "public"."affects" ADD CONSTRAINT "affects_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "public"."metaphorical_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consolidated_conventional_metaphors" ADD CONSTRAINT "consolidated_conventional_metaphors_consolidatedAnalysisId_fkey" FOREIGN KEY ("consolidatedAnalysisId") REFERENCES "public"."consolidated_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consolidated_narratives" ADD CONSTRAINT "consolidated_narratives_consolidatedAnalysisId_fkey" FOREIGN KEY ("consolidatedAnalysisId") REFERENCES "public"."consolidated_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consolidated_narratives" ADD CONSTRAINT "consolidated_narratives_consolidatedRegimeId_fkey" FOREIGN KEY ("consolidatedRegimeId") REFERENCES "public"."consolidated_regimes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consolidated_regime_scenarios" ADD CONSTRAINT "consolidated_regime_scenarios_consolidatedRegimeId_fkey" FOREIGN KEY ("consolidatedRegimeId") REFERENCES "public"."consolidated_regimes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consolidated_regime_scenarios" ADD CONSTRAINT "consolidated_regime_scenarios_consolidatedScenarioId_fkey" FOREIGN KEY ("consolidatedScenarioId") REFERENCES "public"."consolidated_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consolidated_regimes" ADD CONSTRAINT "consolidated_regimes_consolidatedAnalysisId_fkey" FOREIGN KEY ("consolidatedAnalysisId") REFERENCES "public"."consolidated_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consolidated_scenarios" ADD CONSTRAINT "consolidated_scenarios_consolidatedAnalysisId_fkey" FOREIGN KEY ("consolidatedAnalysisId") REFERENCES "public"."consolidated_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."consolidated_scenarios" ADD CONSTRAINT "consolidated_scenarios_consolidatedConventionalMetaphorId_fkey" FOREIGN KEY ("consolidatedConventionalMetaphorId") REFERENCES "public"."consolidated_conventional_metaphors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conventional_metaphors" ADD CONSTRAINT "conventional_metaphors_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "public"."document_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cultural_narratives" ADD CONSTRAINT "cultural_narratives_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "public"."document_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cultural_narratives" ADD CONSTRAINT "cultural_narratives_regimeId_fkey" FOREIGN KEY ("regimeId") REFERENCES "public"."metaphor_regimes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_analyses" ADD CONSTRAINT "document_analyses_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_ingestion_pipelines" ADD CONSTRAINT "document_ingestion_pipelines_corpusId_fkey" FOREIGN KEY ("corpusId") REFERENCES "public"."corpus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_corpusId_fkey" FOREIGN KEY ("corpusId") REFERENCES "public"."corpus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."epistemic_mappings" ADD CONSTRAINT "epistemic_mappings_primaryMetaphorId_fkey" FOREIGN KEY ("primaryMetaphorId") REFERENCES "public"."primary_metaphors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."evaluative_biases" ADD CONSTRAINT "evaluative_biases_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "public"."metaphorical_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."metaphor_regimes" ADD CONSTRAINT "metaphor_regimes_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "public"."document_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."metaphorical_scenarios" ADD CONSTRAINT "metaphorical_scenarios_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "public"."document_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."metaphorical_scenarios" ADD CONSTRAINT "metaphorical_scenarios_conventionalMetaphorId_fkey" FOREIGN KEY ("conventionalMetaphorId") REFERENCES "public"."conventional_metaphors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."narrative_sequences" ADD CONSTRAINT "narrative_sequences_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "public"."metaphorical_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ontological_mappings" ADD CONSTRAINT "ontological_mappings_primaryMetaphorId_fkey" FOREIGN KEY ("primaryMetaphorId") REFERENCES "public"."primary_metaphors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."positioned_social_groups" ADD CONSTRAINT "positioned_social_groups_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "public"."metaphorical_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."primary_metaphor_conventional" ADD CONSTRAINT "primary_metaphor_conventional_conventionalMetaphorId_fkey" FOREIGN KEY ("conventionalMetaphorId") REFERENCES "public"."conventional_metaphors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."primary_metaphor_conventional" ADD CONSTRAINT "primary_metaphor_conventional_primaryMetaphorId_fkey" FOREIGN KEY ("primaryMetaphorId") REFERENCES "public"."primary_metaphors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."primary_metaphors" ADD CONSTRAINT "primary_metaphors_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "public"."document_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."regime_derived_metaphors" ADD CONSTRAINT "regime_derived_metaphors_regimeId_fkey" FOREIGN KEY ("regimeId") REFERENCES "public"."metaphor_regimes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scenario_regimes" ADD CONSTRAINT "scenario_regimes_regimeId_fkey" FOREIGN KEY ("regimeId") REFERENCES "public"."metaphor_regimes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scenario_regimes" ADD CONSTRAINT "scenario_regimes_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "public"."metaphorical_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_corpus" ADD CONSTRAINT "user_corpus_corpusId_fkey" FOREIGN KEY ("corpusId") REFERENCES "public"."corpus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_corpus" ADD CONSTRAINT "user_corpus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."value_axes" ADD CONSTRAINT "value_axes_regimeId_fkey" FOREIGN KEY ("regimeId") REFERENCES "public"."metaphor_regimes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

