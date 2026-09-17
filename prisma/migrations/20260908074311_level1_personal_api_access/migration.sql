-- CreateEnum
CREATE TYPE "Level1ApiMode" AS ENUM ('MELT', 'PERSONAL');

-- AlterTable
ALTER TABLE "document_analyses" ADD COLUMN     "level1ApiMode" "Level1ApiMode" NOT NULL DEFAULT 'MELT';

-- CreateTable
CREATE TABLE "user_ai_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "keyHint" VARCHAR(20),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_ai_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_ai_credentials_userId_provider_key" ON "user_ai_credentials"("userId", "provider");

-- AddForeignKey
ALTER TABLE "user_ai_credentials" ADD CONSTRAINT "user_ai_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
