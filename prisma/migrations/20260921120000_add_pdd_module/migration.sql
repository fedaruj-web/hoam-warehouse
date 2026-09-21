-- PDD policy and reproducible per-asset calculation history.
CREATE TABLE IF NOT EXISTS "PddPolicy" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "reviewFrequency" TEXT NOT NULL DEFAULT 'Mensal',
  "portfolioType" TEXT NOT NULL DEFAULT 'PULVERIZED_UNSECURED',
  "method" TEXT NOT NULL DEFAULT 'EXPECTED_LOSS_AGING',
  "delinquencyBands" JSONB NOT NULL,
  "defaultCollateralHaircutPct" DECIMAL(8,4) NOT NULL DEFAULT 30,
  "recoveryCostPct" DECIMAL(8,4) NOT NULL DEFAULT 0,
  "wagonEffectMode" TEXT NOT NULL DEFAULT 'PARTIAL',
  "wagonEffectPct" DECIMAL(8,4) NOT NULL DEFAULT 50,
  "concentrationThresholdPct" DECIMAL(8,4) NOT NULL DEFAULT 20,
  "concentratedAdjustmentPct" DECIMAL(8,4) NOT NULL DEFAULT 10,
  "renegotiationAdjustmentPct" DECIMAL(8,4) NOT NULL DEFAULT 10,
  "qualitativeTriggers" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "PddPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PddPolicy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PddCalculation" (
  "id" TEXT NOT NULL,
  "receivableId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "referenceDate" TIMESTAMP(3) NOT NULL,
  "daysPastDue" INTEGER NOT NULL,
  "grossExposure" DECIMAL(18,2) NOT NULL,
  "collateralValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "haircutPct" DECIMAL(8,4) NOT NULL DEFAULT 0,
  "recoverableValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "baseLoss" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "baseProvisionRatePct" DECIMAL(8,4) NOT NULL,
  "qualitativeAdjustmentPct" DECIMAL(8,4) NOT NULL DEFAULT 0,
  "wagonAdjustmentPct" DECIMAL(8,4) NOT NULL DEFAULT 0,
  "finalProvisionRatePct" DECIMAL(8,4) NOT NULL,
  "provisionAmount" DECIMAL(18,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Calculado',
  "rationale" TEXT,
  "inputSnapshot" JSONB NOT NULL,
  "calculatedById" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PddCalculation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PddCalculation_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PddCalculation_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "PddPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PddCalculation_calculatedById_fkey" FOREIGN KEY ("calculatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PddCalculation_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PddPolicy_code_version_key" ON "PddPolicy"("code", "version");
CREATE INDEX IF NOT EXISTS "PddPolicy_active_effectiveAt_idx" ON "PddPolicy"("active", "effectiveAt");
CREATE UNIQUE INDEX IF NOT EXISTS "PddCalculation_receivableId_policyId_referenceDate_key" ON "PddCalculation"("receivableId", "policyId", "referenceDate");
CREATE INDEX IF NOT EXISTS "PddCalculation_referenceDate_status_idx" ON "PddCalculation"("referenceDate", "status");
CREATE INDEX IF NOT EXISTS "PddCalculation_receivableId_referenceDate_idx" ON "PddCalculation"("receivableId", "referenceDate");
CREATE INDEX IF NOT EXISTS "PddCalculation_policyId_referenceDate_idx" ON "PddCalculation"("policyId", "referenceDate");

-- The application accesses Postgres only from trusted server routes. Keep these
-- tables unavailable to Supabase Data API roles and retain RLS as defense in depth.
ALTER TABLE "PddPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PddCalculation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PddPolicy" FROM anon, authenticated;
REVOKE ALL ON TABLE "PddCalculation" FROM anon, authenticated;
