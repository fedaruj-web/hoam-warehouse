import type { PddBand, PddPolicy, PddPortfolioType, PddWagonEffectMode } from "@/lib/types";

export const DEFAULT_PDD_BANDS: PddBand[] = [
  { fromDays: 0, toDays: 14, ratePct: 0.5 },
  { fromDays: 15, toDays: 30, ratePct: 3 },
  { fromDays: 31, toDays: 60, ratePct: 10 },
  { fromDays: 61, toDays: 90, ratePct: 30 },
  { fromDays: 91, toDays: 120, ratePct: 50 },
  { fromDays: 121, toDays: 180, ratePct: 70 },
  { fromDays: 181, toDays: null, ratePct: 100 },
];

export const DEFAULT_PDD_POLICY: PddPolicy = {
  code: "POL-HOAM-PDD",
  name: "Política de PDD - Ativos securitizados",
  version: 1,
  effectiveAt: new Date().toISOString().slice(0, 10),
  reviewFrequency: "Mensal",
  portfolioType: "PULVERIZED_UNSECURED",
  method: "EXPECTED_LOSS_AGING",
  delinquencyBands: DEFAULT_PDD_BANDS,
  defaultCollateralHaircutPct: 30,
  recoveryCostPct: 0,
  wagonEffectMode: "PARTIAL",
  wagonEffectPct: 50,
  concentrationThresholdPct: 20,
  concentratedAdjustmentPct: 10,
  renegotiationAdjustmentPct: 10,
  qualitativeTriggers: [
    "Renegociação ou alongamento relevante",
    "Descumprimento contratual ou covenant",
    "Recuperação judicial ou evento societário relevante",
    "Deterioração material do setor ou da capacidade de pagamento",
    "Recompra ou substituição motivada por risco de crédito",
  ],
};

function finiteNumber(value: unknown, fallback: number, minimum = 0, maximum = Number.POSITIVE_INFINITY) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function portfolioType(value: unknown): PddPortfolioType {
  return ["PULVERIZED_UNSECURED", "PULVERIZED_COLLATERAL_ORIGIN", "PULVERIZED_COLLATERAL_CESSION", "CONCENTRATED"].includes(String(value))
    ? value as PddPortfolioType
    : DEFAULT_PDD_POLICY.portfolioType;
}

function wagonMode(value: unknown): PddWagonEffectMode {
  return ["NONE", "PARTIAL", "FULL"].includes(String(value)) ? value as PddWagonEffectMode : DEFAULT_PDD_POLICY.wagonEffectMode;
}

export function normalizePddPolicy(input: unknown): PddPolicy {
  const record = (input ?? {}) as Record<string, unknown>;
  const rawBands = Array.isArray(record.delinquencyBands) ? record.delinquencyBands : DEFAULT_PDD_BANDS;
  const bands = rawBands
    .map((item) => {
      const band = (item ?? {}) as Record<string, unknown>;
      return {
        fromDays: Math.trunc(finiteNumber(band.fromDays, 0)),
        toDays: band.toDays === null || band.toDays === "" ? null : Math.trunc(finiteNumber(band.toDays, 0)),
        ratePct: finiteNumber(band.ratePct, 0, 0, 100),
      };
    })
    .sort((a, b) => a.fromDays - b.fromDays);

  return {
    ...DEFAULT_PDD_POLICY,
    id: record.id ? String(record.id) : undefined,
    code: String(record.code ?? DEFAULT_PDD_POLICY.code),
    name: String(record.name ?? DEFAULT_PDD_POLICY.name),
    version: Math.max(1, Math.trunc(finiteNumber(record.version, DEFAULT_PDD_POLICY.version, 1))),
    effectiveAt: String(record.effectiveAt ?? DEFAULT_PDD_POLICY.effectiveAt).slice(0, 10),
    reviewFrequency: String(record.reviewFrequency ?? DEFAULT_PDD_POLICY.reviewFrequency),
    portfolioType: portfolioType(record.portfolioType),
    method: String(record.method ?? DEFAULT_PDD_POLICY.method),
    delinquencyBands: bands.length ? bands : DEFAULT_PDD_BANDS,
    defaultCollateralHaircutPct: finiteNumber(record.defaultCollateralHaircutPct, DEFAULT_PDD_POLICY.defaultCollateralHaircutPct, 0, 100),
    recoveryCostPct: finiteNumber(record.recoveryCostPct, DEFAULT_PDD_POLICY.recoveryCostPct, 0, 100),
    wagonEffectMode: wagonMode(record.wagonEffectMode),
    wagonEffectPct: finiteNumber(record.wagonEffectPct, DEFAULT_PDD_POLICY.wagonEffectPct, 0, 100),
    concentrationThresholdPct: finiteNumber(record.concentrationThresholdPct, DEFAULT_PDD_POLICY.concentrationThresholdPct, 0, 100),
    concentratedAdjustmentPct: finiteNumber(record.concentratedAdjustmentPct, DEFAULT_PDD_POLICY.concentratedAdjustmentPct, 0, 100),
    renegotiationAdjustmentPct: finiteNumber(record.renegotiationAdjustmentPct, DEFAULT_PDD_POLICY.renegotiationAdjustmentPct, 0, 100),
    qualitativeTriggers: Array.isArray(record.qualitativeTriggers)
      ? record.qualitativeTriggers.map(String).filter(Boolean)
      : DEFAULT_PDD_POLICY.qualitativeTriggers,
  };
}

export function pddRateForAging(daysPastDue: number, bands: PddBand[]) {
  const band = bands.find((item) => daysPastDue >= item.fromDays && (item.toDays === null || daysPastDue <= item.toDays));
  return band?.ratePct ?? bands.at(-1)?.ratePct ?? 0;
}

