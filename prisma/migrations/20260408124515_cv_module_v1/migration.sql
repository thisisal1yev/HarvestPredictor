-- CreateEnum
CREATE TYPE "CvModelFormat" AS ENUM ('onnx');

-- CreateEnum
CREATE TYPE "CvStreamProtocol" AS ENUM ('rtsp', 'rtmp', 'http_mjpeg');

-- CreateEnum
CREATE TYPE "CvConnectionStatus" AS ENUM ('idle', 'active', 'disconnected', 'error');

-- CreateEnum
CREATE TYPE "CvDetectionCategory" AS ENUM ('disease', 'pest', 'weed');

-- CreateEnum
CREATE TYPE "CvDetectionSeverity" AS ENUM ('confirmed', 'likely', 'possible');

-- CreateTable
CREATE TABLE "CVModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "format" "CvModelFormat" NOT NULL DEFAULT 'onnx',
    "cropType" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "fileSize" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "metadata" JSONB,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CVModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" "CvStreamProtocol" NOT NULL,
    "streamUrl" TEXT NOT NULL,
    "usernameEnc" TEXT,
    "passwordEnc" TEXT,
    "status" "CvConnectionStatus" NOT NULL DEFAULT 'idle',
    "lastFrameAt" TIMESTAMP(3),
    "lastDetectionAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "reconnectAttempt" INTEGER NOT NULL DEFAULT 0,
    "modelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fieldId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Detection" (
    "id" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "category" "CvDetectionCategory" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "severity" "CvDetectionSeverity" NOT NULL,
    "bbox" JSONB NOT NULL,
    "snapshotKey" TEXT,
    "thumbReady" BOOLEAN NOT NULL DEFAULT false,
    "connectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Detection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL,
    "diseaseName" TEXT NOT NULL,
    "diseaseNameUz" TEXT,
    "category" TEXT NOT NULL,
    "symptoms" TEXT NOT NULL,
    "symptomsUz" TEXT,
    "treatment" TEXT NOT NULL,
    "treatmentUz" TEXT,
    "prevention" TEXT,
    "preventionUz" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "cropTypes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CVModel_userId_idx" ON "CVModel"("userId");

-- CreateIndex
CREATE INDEX "CVModel_userId_isDefault_idx" ON "CVModel"("userId", "isDefault");

-- CreateIndex
CREATE INDEX "Connection_userId_status_idx" ON "Connection"("userId", "status");

-- CreateIndex
CREATE INDEX "Connection_modelId_idx" ON "Connection"("modelId");

-- CreateIndex
CREATE INDEX "Detection_userId_detectedAt_idx" ON "Detection"("userId", "detectedAt" DESC);

-- CreateIndex
CREATE INDEX "Detection_connectionId_detectedAt_idx" ON "Detection"("connectionId", "detectedAt" DESC);

-- CreateIndex
CREATE INDEX "Detection_className_idx" ON "Detection"("className");

-- CreateIndex
CREATE INDEX "Detection_thumbReady_detectedAt_idx" ON "Detection"("thumbReady", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeBase_diseaseName_key" ON "KnowledgeBase"("diseaseName");

-- AddForeignKey
ALTER TABLE "CVModel" ADD CONSTRAINT "CVModel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "CVModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "Field"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Detection" ADD CONSTRAINT "Detection_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Detection" ADD CONSTRAINT "Detection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index: at most one default CVModel per (userId, cropType).
-- NULL cropType is treated as a sentinel "__general__" so the index constraint covers both cases.
CREATE UNIQUE INDEX "cvmodel_one_default_per_crop"
  ON "CVModel" ("userId", COALESCE("cropType", '__general__'))
  WHERE "isDefault" = TRUE;
