-- AlterTable
ALTER TABLE "corpus" ADD COLUMN     "level0Config" JSONB;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "level0ConfigOverrides" JSONB;
