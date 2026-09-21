import type { PddCalculation as PrismaPddCalculation, PddPolicy as PrismaPddPolicy, Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_PDD_POLICY, normalizePddPolicy, pddRateForAging } from "@/lib/pdd";
import type { PddCalculation, PddOverview, PddPolicy } from "@/lib/types";

type DbClient = PrismaClient | Prisma.TransactionClient;

function decimal(value: unknown) {
  return Number(value ?? 0);
}

function utcDay(value: string | Date) {
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Data de referência inválida.");
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function mapPolicy(row: PrismaPddPolicy): PddPolicy {
  return normalizePddPolicy({
    id: row.id,
    code: row.code,
    name: row.name,
    version: row.version,
    effectiveAt: row.effectiveAt.toISOString().slice(0, 10),
    reviewFrequency: row.reviewFrequency,
    portfolioType: row.portfolioType,
    method: row.method,
    delinquencyBands: row.delinquencyBands,
    defaultCollateralHaircutPct: decimal(row.defaultCollateralHaircutPct),
    recoveryCostPct: decimal(row.recoveryCostPct),
    wagonEffectMode: row.wagonEffectMode,
    wagonEffectPct: decimal(row.wagonEffectPct),
    concentrationThresholdPct: decimal(row.concentrationThresholdPct),
    concentratedAdjustmentPct: decimal(row.concentratedAdjustmentPct),
    renegotiationAdjustmentPct: decimal(row.renegotiationAdjustmentPct),
    qualitativeTriggers: row.qualitativeTriggers,
  });
}

export async function getActivePddPolicy(db: DbClient, createdById?: string | null) {
  const active = await db.pddPolicy.findFirst({
    where: { active: true },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
  });
  if (active) return active;

  return db.pddPolicy.create({
    data: {
      code: DEFAULT_PDD_POLICY.code,
      name: DEFAULT_PDD_POLICY.name,
      version: DEFAULT_PDD_POLICY.version,
      effectiveAt: utcDay(DEFAULT_PDD_POLICY.effectiveAt),
      reviewFrequency: DEFAULT_PDD_POLICY.reviewFrequency,
      portfolioType: DEFAULT_PDD_POLICY.portfolioType,
      method: DEFAULT_PDD_POLICY.method,
      delinquencyBands: DEFAULT_PDD_POLICY.delinquencyBands,
      defaultCollateralHaircutPct: DEFAULT_PDD_POLICY.defaultCollateralHaircutPct,
      recoveryCostPct: DEFAULT_PDD_POLICY.recoveryCostPct,
      wagonEffectMode: DEFAULT_PDD_POLICY.wagonEffectMode,
      wagonEffectPct: DEFAULT_PDD_POLICY.wagonEffectPct,
      concentrationThresholdPct: DEFAULT_PDD_POLICY.concentrationThresholdPct,
      concentratedAdjustmentPct: DEFAULT_PDD_POLICY.concentratedAdjustmentPct,
      renegotiationAdjustmentPct: DEFAULT_PDD_POLICY.renegotiationAdjustmentPct,
      qualitativeTriggers: DEFAULT_PDD_POLICY.qualitativeTriggers,
      createdById: createdById ?? null,
    },
  });
}

export async function savePddPolicy(db: PrismaClient, input: unknown, userId?: string | null) {
  return db.$transaction(async (tx) => {
    const current = await getActivePddPolicy(tx, userId);
    const normalized = normalizePddPolicy({ ...mapPolicy(current), ...(input as object), version: current.version + 1 });
    await tx.pddPolicy.updateMany({ where: { active: true }, data: { active: false, retiredAt: new Date() } });
    return tx.pddPolicy.create({
      data: {
        code: normalized.code,
        name: normalized.name,
        version: normalized.version,
        effectiveAt: utcDay(normalized.effectiveAt),
        reviewFrequency: normalized.reviewFrequency,
        portfolioType: normalized.portfolioType,
        method: normalized.method,
        delinquencyBands: normalized.delinquencyBands,
        defaultCollateralHaircutPct: normalized.defaultCollateralHaircutPct,
        recoveryCostPct: normalized.recoveryCostPct,
        wagonEffectMode: normalized.wagonEffectMode,
        wagonEffectPct: normalized.wagonEffectPct,
        concentrationThresholdPct: normalized.concentrationThresholdPct,
        concentratedAdjustmentPct: normalized.concentratedAdjustmentPct,
        renegotiationAdjustmentPct: normalized.renegotiationAdjustmentPct,
        qualitativeTriggers: normalized.qualitativeTriggers,
        createdById: userId ?? null,
      },
    });
  });
}

function mapCalculation(row: PrismaPddCalculation & {
  receivable: { externalId: string; dueDate: Date; assignor: { legalName: string }; debtor: { legalName: string } };
  policy: { version: number };
}): PddCalculation {
  return {
    id: row.id,
    receivableId: row.receivableId,
    externalId: row.receivable.externalId,
    assignorName: row.receivable.assignor.legalName,
    debtorName: row.receivable.debtor.legalName,
    referenceDate: row.referenceDate.toISOString().slice(0, 10),
    dueDate: row.receivable.dueDate.toISOString().slice(0, 10),
    daysPastDue: row.daysPastDue,
    grossExposure: decimal(row.grossExposure),
    recoverableValue: decimal(row.recoverableValue),
    baseLoss: decimal(row.baseLoss),
    baseProvisionRatePct: decimal(row.baseProvisionRatePct),
    qualitativeAdjustmentPct: decimal(row.qualitativeAdjustmentPct),
    wagonAdjustmentPct: decimal(row.wagonAdjustmentPct),
    finalProvisionRatePct: decimal(row.finalProvisionRatePct),
    provisionAmount: decimal(row.provisionAmount),
    status: row.status,
    rationale: row.rationale,
    policyVersion: row.policy.version,
    inputSnapshot: row.inputSnapshot as Record<string, unknown>,
  };
}

export async function calculatePdd(db: PrismaClient, referenceInput: string | undefined, userId?: string | null) {
  const referenceDate = utcDay(referenceInput ?? new Date());
  const policyRow = await getActivePddPolicy(db, userId);
  const policy = mapPolicy(policyRow);
  const portfolio = await db.portfolioItem.findMany({
    where: { deletedAt: null, outstandingValue: { gt: 0 } },
    include: { receivable: { include: { assignor: true, debtor: true } } },
    orderBy: { receivable: { dueDate: "asc" } },
  });
  const totalExposure = portfolio.reduce((sum, item) => sum + decimal(item.outstandingValue), 0);

  const drafts = portfolio.map((item) => {
    const receivable = item.receivable;
    const exposure = decimal(item.outstandingValue);
    const daysPastDue = Math.max(0, Math.floor((referenceDate.getTime() - utcDay(receivable.dueDate).getTime()) / 86_400_000));
    const baseRate = pddRateForAging(daysPastDue, policy.delinquencyBands);
    const flags: string[] = [];
    let qualitativeAdjustment = 0;
    const operationalStatus = `${item.status} ${receivable.status}`.toLowerCase();
    if (/renegoci|alongamento|recompra|substitui/.test(operationalStatus)) {
      flags.push("Evento de renegociação, alongamento, recompra ou substituição");
      qualitativeAdjustment += policy.renegotiationAdjustmentPct;
    }
    if (["BLOCKED", "REVIEW"].includes(receivable.debtor.status)) {
      flags.push("Sacado bloqueado ou em revisão cadastral/creditícia");
      qualitativeAdjustment += policy.concentratedAdjustmentPct;
    }
    const concentrationPct = totalExposure > 0 ? (exposure / totalExposure) * 100 : 0;
    if (policy.portfolioType === "CONCENTRATED" || concentrationPct >= policy.concentrationThresholdPct) {
      flags.push(`Exposição concentrada (${concentrationPct.toFixed(2)}% da carteira)`);
      qualitativeAdjustment += policy.concentratedAdjustmentPct;
    }
    const collateralValue = 0;
    const recoverableValue = 0;
    const baseLoss = Math.max(0, exposure - recoverableValue);
    return {
      item,
      exposure,
      daysPastDue,
      baseRate,
      qualitativeAdjustment: Math.min(100 - baseRate, qualitativeAdjustment),
      preWagonRate: Math.min(100, baseRate + qualitativeAdjustment),
      concentrationPct,
      collateralValue,
      recoverableValue,
      baseLoss,
      flags,
    };
  });

  const maxRateByDebtor = new Map<string, number>();
  for (const draft of drafts) {
    const key = draft.item.receivable.debtorId;
    maxRateByDebtor.set(key, Math.max(maxRateByDebtor.get(key) ?? 0, draft.preWagonRate));
  }

  await db.$transaction(async (tx) => {
    for (const draft of drafts) {
      const debtorMax = maxRateByDebtor.get(draft.item.receivable.debtorId) ?? draft.preWagonRate;
      const wagonTarget = policy.wagonEffectMode === "FULL"
        ? debtorMax
        : policy.wagonEffectMode === "PARTIAL"
          ? debtorMax * (policy.wagonEffectPct / 100)
          : draft.preWagonRate;
      const finalRate = Math.min(100, Math.max(draft.preWagonRate, wagonTarget));
      const wagonAdjustment = Math.max(0, finalRate - draft.preWagonRate);
      const provisionAmount = Math.min(draft.exposure, draft.baseLoss * finalRate / 100);
      const flags = [...draft.flags];
      if (wagonAdjustment > 0) flags.push(`Efeito vagão aplicado pelo risco correlacionado do sacado (+${wagonAdjustment.toFixed(2)} p.p.)`);
      if (policy.portfolioType.includes("COLLATERAL") && draft.collateralValue === 0) flags.push("Garantia sem valor cadastrado; cálculo prudencial sem redutor");
      const rationale = flags.length ? flags.join("; ") : "Régua objetiva de atraso, sem gatilho qualitativo adicional.";
      const snapshot = {
        methodology: "Perda esperada sobre o ativo",
        policy: { ...policy, id: policyRow.id },
        source: {
          receivableId: draft.item.receivableId,
          externalId: draft.item.receivable.externalId,
          debtorId: draft.item.receivable.debtorId,
          dueDate: draft.item.receivable.dueDate.toISOString(),
          portfolioStatus: draft.item.status,
        },
        assumptions: {
          grossExposure: draft.exposure,
          collateralValue: draft.collateralValue,
          recoverableValue: draft.recoverableValue,
          concentrationPct: draft.concentrationPct,
          qualitativeFlags: flags,
        },
        generatedAt: new Date().toISOString(),
      };
      await tx.pddCalculation.upsert({
        where: { receivableId_policyId_referenceDate: { receivableId: draft.item.receivableId, policyId: policyRow.id, referenceDate } },
        create: {
          receivableId: draft.item.receivableId,
          policyId: policyRow.id,
          referenceDate,
          daysPastDue: draft.daysPastDue,
          grossExposure: draft.exposure,
          collateralValue: draft.collateralValue,
          haircutPct: policy.defaultCollateralHaircutPct,
          recoverableValue: draft.recoverableValue,
          baseLoss: draft.baseLoss,
          baseProvisionRatePct: draft.baseRate,
          qualitativeAdjustmentPct: draft.qualitativeAdjustment,
          wagonAdjustmentPct: wagonAdjustment,
          finalProvisionRatePct: finalRate,
          provisionAmount,
          status: flags.length ? "Em revisão" : "Calculado",
          rationale,
          inputSnapshot: snapshot,
          calculatedById: userId ?? null,
        },
        update: {
          daysPastDue: draft.daysPastDue,
          grossExposure: draft.exposure,
          collateralValue: draft.collateralValue,
          haircutPct: policy.defaultCollateralHaircutPct,
          recoverableValue: draft.recoverableValue,
          baseLoss: draft.baseLoss,
          baseProvisionRatePct: draft.baseRate,
          qualitativeAdjustmentPct: draft.qualitativeAdjustment,
          wagonAdjustmentPct: wagonAdjustment,
          finalProvisionRatePct: finalRate,
          provisionAmount,
          status: flags.length ? "Em revisão" : "Calculado",
          rationale,
          inputSnapshot: snapshot,
          calculatedById: userId ?? null,
          approvedById: null,
          approvedAt: null,
        },
      });
    }
  });

  return getPddOverview(db, referenceDate.toISOString().slice(0, 10), userId);
}

export async function getPddOverview(db: PrismaClient, referenceInput?: string, userId?: string | null): Promise<PddOverview> {
  const policyRow = await getActivePddPolicy(db, userId);
  const latest = referenceInput
    ? utcDay(referenceInput)
    : (await db.pddCalculation.findFirst({ orderBy: { referenceDate: "desc" }, select: { referenceDate: true } }))?.referenceDate ?? utcDay(new Date());
  const rows = await db.pddCalculation.findMany({
    where: { referenceDate: latest, policyId: policyRow.id },
    include: { receivable: { include: { assignor: true, debtor: true } }, policy: true },
    orderBy: [{ daysPastDue: "desc" }, { provisionAmount: "desc" }],
  });
  const calculations = rows.map(mapCalculation);
  const grossExposure = calculations.reduce((sum, item) => sum + item.grossExposure, 0);
  const recoverableValue = calculations.reduce((sum, item) => sum + item.recoverableValue, 0);
  const provisionAmount = calculations.reduce((sum, item) => sum + item.provisionAmount, 0);
  return {
    policy: mapPolicy(policyRow),
    referenceDate: latest.toISOString().slice(0, 10),
    calculations,
    summary: {
      grossExposure,
      recoverableValue,
      provisionAmount,
      netCarryingValue: Math.max(0, grossExposure - provisionAmount),
      coveragePct: grossExposure > 0 ? provisionAmount / grossExposure * 100 : 0,
      overdueExposure: calculations.filter((item) => item.daysPastDue > 0).reduce((sum, item) => sum + item.grossExposure, 0),
      affectedByWagon: calculations.filter((item) => item.wagonAdjustmentPct > 0).length,
      pendingApproval: calculations.filter((item) => item.status !== "Aprovado").length,
    },
  };
}
