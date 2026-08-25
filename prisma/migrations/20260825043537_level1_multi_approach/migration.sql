-- AlterTable
ALTER TABLE "document_analyses" ADD COLUMN     "level1Metadata" JSONB;

-- AlterTable
ALTER TABLE "primary_metaphors" ADD COLUMN     "approach" "AiProvider",
ADD COLUMN     "chapter" VARCHAR(500),
ADD COLUMN     "crossApproachConfidence" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "expandedContext" TEXT,
ADD COLUMN     "modelConfidence" DOUBLE PRECISION,
ADD COLUMN     "modelName" VARCHAR(200),
ADD COLUMN     "sentenceId" VARCHAR(200);
