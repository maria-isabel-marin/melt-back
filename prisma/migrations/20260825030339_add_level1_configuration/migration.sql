-- AlterTable
ALTER TABLE "corpus" ADD COLUMN     "level1Config" JSONB;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "level1ConfigOverrides" JSONB;
