import type { Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_ELIGIBILITY_POLICY } from "@/lib/domain";
import type { EligibilityPendingBehavior, EligibilityPolicy } from "@/lib/types";

export const ELIGIBILITY_POLICY_RULE_NAME = "Parâmetros da política de elegibilidade";

function numberOrDefault(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pendingBehaviorOrDefault(value: unknown): EligibilityPendingBehavior {
  return value === "block" || value === "approve" || value === "review" ? value : DEFAULT_ELIGIBILITY_POLICY.pendingConfirmationBehavior;
}

export function normalizeEligibilityPolicy(input: unknown): EligibilityPolicy {
  const record = (input ?? {}) as Partial<Record<keyof EligibilityPolicy, unknown>>;
  return {
    ...DEFAULT_ELIGIBILITY_POLICY,
    code: String(record.code ?? DEFAULT_ELIGIBILITY_POLICY.code),
    name: String(record.name ?? DEFAULT_ELIGIBILITY_POLICY.name),
    version: numberOrDefault(record.version, DEFAULT_ELIGIBILITY_POLICY.version),
    effectiveAt: String(record.effectiveAt ?? DEFAULT_ELIGIBILITY_POLICY.effectiveAt),
    minFaceValue: numberOrDefault(record.minFaceValue, DEFAULT_ELIGIBILITY_POLICY.minFaceValue),
    maxTenorDays: numberOrDefault(record.maxTenorDays, DEFAULT_ELIGIBILITY_POLICY.maxTenorDays),
    minDebtorRating: String(record.minDebtorRating ?? DEFAULT_ELIGIBILITY_POLICY.minDebtorRating),
    requireConfirmation: record.requireConfirmation === false ? false : DEFAULT_ELIGIBILITY_POLICY.requireConfirmation,
    pendingConfirmationBehavior: pendingBehaviorOrDefault(record.pendingConfirmationBehavior),
    baseMonthlyRatePercent: numberOrDefault(record.baseMonthlyRatePercent, DEFAULT_ELIGIBILITY_POLICY.baseMonthlyRatePercent),
    riskSpreadPercent: numberOrDefault(record.riskSpreadPercent, DEFAULT_ELIGIBILITY_POLICY.riskSpreadPercent),
    serviceFeeBps: numberOrDefault(record.serviceFeeBps, DEFAULT_ELIGIBILITY_POLICY.serviceFeeBps),
  };
}

export async function getActiveEligibilityPolicy(db: PrismaClient | Prisma.TransactionClient | null): Promise<EligibilityPolicy> {
  if (!db) return DEFAULT_ELIGIBILITY_POLICY;
  const rule = await db.eligibilityRule.findFirst({
    where: { name: ELIGIBILITY_POLICY_RULE_NAME, active: true, deletedAt: null },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
  });
  return normalizeEligibilityPolicy(rule?.value ?? DEFAULT_ELIGIBILITY_POLICY);
}

export async function saveActiveEligibilityPolicy(db: PrismaClient, input: unknown): Promise<EligibilityPolicy> {
  const current = await getActiveEligibilityPolicy(db);
  const policy = normalizeEligibilityPolicy({
    ...current,
    ...(input ?? {}),
    version: current.version + 1,
    effectiveAt: new Date().toISOString().slice(0, 10),
  });

  await db.eligibilityRule.updateMany({
    where: { name: ELIGIBILITY_POLICY_RULE_NAME, active: true, deletedAt: null },
    data: { active: false, retiredAt: new Date() },
  });

  await db.eligibilityRule.create({
    data: {
      name: ELIGIBILITY_POLICY_RULE_NAME,
      ruleType: "POLICY_PARAMETERS",
      operator: "CONFIG",
      value: policy,
      policyCode: policy.code,
      policyName: policy.name,
      effectiveAt: new Date(`${policy.effectiveAt}T00:00:00.000Z`),
      active: true,
      version: policy.version,
    },
  });

  return policy;
}
