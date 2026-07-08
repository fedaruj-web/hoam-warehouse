-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'CREDIT', 'OPERATIONS', 'COMMITTEE', 'VIEWER');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'REVIEW', 'BLOCKED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'BLOCKED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PermissionAction" AS ENUM ('VIEW', 'CREATE', 'UPDATE', 'APPROVE', 'PURCHASE', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('IMPORTED', 'ELIGIBLE', 'REVIEW', 'INELIGIBLE', 'APPROVED', 'PURCHASED', 'SETTLED', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CONTRACT', 'COLLATERAL', 'RECEIPT', 'KYC', 'BORDER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'VALID', 'EXPIRED', 'REVIEW');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('INFLOW', 'OUTFLOW');

-- CreateEnum
CREATE TYPE "FundingStatus" AS ENUM ('STRUCTURING', 'ISSUED', 'SETTLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "permissionGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PermissionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupPermission" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" "PermissionAction" NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignor" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "taxId" TEXT NOT NULL,
    "sector" TEXT,
    "creditLimit" DECIMAL(18,2) NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Assignor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Debtor" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "taxId" TEXT NOT NULL,
    "rating" TEXT,
    "exposureLimit" DECIMAL(18,2),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Debtor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "validationErrors" JSONB,
    "importedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receivable" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "assignorId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "faceValue" DECIMAL(18,2) NOT NULL,
    "purchasePrice" DECIMAL(18,2),
    "status" "ReceivableStatus" NOT NULL DEFAULT 'IMPORTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Receivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EligibilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityEvaluation" (
    "id" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "message" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibilityEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "assignorId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "faceValue" DECIMAL(18,2) NOT NULL,
    "purchaseValue" DECIMAL(18,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "purchasePrice" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioItem" (
    "id" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "acquisitionValue" DECIMAL(18,2) NOT NULL,
    "outstandingValue" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PortfolioItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT,
    "sizeBytes" INTEGER,
    "assignorId" TEXT,
    "debtorId" TEXT,
    "receivableId" TEXT,
    "purchaseId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingIssue" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "instrument" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "rate" TEXT NOT NULL,
    "maturity" TIMESTAMP(3),
    "status" "FundingStatus" NOT NULL DEFAULT 'STRUCTURING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FundingIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTransition" (
    "id" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "fromStatus" "ReceivableStatus",
    "toStatus" "ReceivableStatus" NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_deletedAt_status_idx" ON "User"("deletedAt", "status");

-- CreateIndex
CREATE INDEX "User_permissionGroupId_idx" ON "User"("permissionGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_expiresAt_idx" ON "UserSession"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionGroup_code_key" ON "PermissionGroup"("code");

-- CreateIndex
CREATE INDEX "PermissionGroup_deletedAt_active_idx" ON "PermissionGroup"("deletedAt", "active");

-- CreateIndex
CREATE INDEX "GroupPermission_module_action_idx" ON "GroupPermission"("module", "action");

-- CreateIndex
CREATE UNIQUE INDEX "GroupPermission_groupId_module_action_key" ON "GroupPermission"("groupId", "module", "action");

-- CreateIndex
CREATE UNIQUE INDEX "Assignor_code_key" ON "Assignor"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Assignor_taxId_key" ON "Assignor"("taxId");

-- CreateIndex
CREATE INDEX "Assignor_deletedAt_status_idx" ON "Assignor"("deletedAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Debtor_code_key" ON "Debtor"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Debtor_taxId_key" ON "Debtor"("taxId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_code_key" ON "ImportBatch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_externalId_key" ON "Receivable"("externalId");

-- CreateIndex
CREATE INDEX "Receivable_deletedAt_status_idx" ON "Receivable"("deletedAt", "status");

-- CreateIndex
CREATE INDEX "Receivable_dueDate_idx" ON "Receivable"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "EligibilityEvaluation_receivableId_ruleId_key" ON "EligibilityEvaluation"("receivableId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_code_key" ON "Purchase"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseItem_receivableId_key" ON "PurchaseItem"("receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioItem_receivableId_key" ON "PortfolioItem"("receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_code_key" ON "Document"("code");

-- CreateIndex
CREATE INDEX "Document_type_status_idx" ON "Document"("type", "status");

-- CreateIndex
CREATE INDEX "Document_receivableId_idx" ON "Document"("receivableId");

-- CreateIndex
CREATE INDEX "Document_purchaseId_idx" ON "Document"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_code_key" ON "CashMovement"("code");

-- CreateIndex
CREATE INDEX "CashMovement_date_type_idx" ON "CashMovement"("date", "type");

-- CreateIndex
CREATE UNIQUE INDEX "FundingIssue_code_key" ON "FundingIssue"("code");

-- CreateIndex
CREATE INDEX "WorkflowTransition_receivableId_createdAt_idx" ON "WorkflowTransition"("receivableId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_permissionGroupId_fkey" FOREIGN KEY ("permissionGroupId") REFERENCES "PermissionGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPermission" ADD CONSTRAINT "GroupPermission_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PermissionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_assignorId_fkey" FOREIGN KEY ("assignorId") REFERENCES "Assignor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityEvaluation" ADD CONSTRAINT "EligibilityEvaluation_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityEvaluation" ADD CONSTRAINT "EligibilityEvaluation_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "EligibilityRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_assignorId_fkey" FOREIGN KEY ("assignorId") REFERENCES "Assignor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioItem" ADD CONSTRAINT "PortfolioItem_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTransition" ADD CONSTRAINT "WorkflowTransition_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
