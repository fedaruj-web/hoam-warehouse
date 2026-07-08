import type {
  AccessGroup,
  AppUser,
  Assignor,
  Audit,
  Debtor,
  EligibilityCheck,
  AcquisitionPricing,
  PermissionAction,
  Receivable,
  ReceivableStatus,
} from "./types";

export const DEFAULT_ACQUISITION_ANNUAL_RATE = 0.285;
export const DEFAULT_SERVICE_FEE_BPS = 0;

export const fmt = (n: number) =>
  n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

export const fmtPct = (n: number) =>
  n.toLocaleString("pt-BR", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const now = () =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

export function createAudit(
  previous: Audit[],
  action: string,
  entity: string,
  user = "Felipe Martins",
  before?: unknown,
  after?: unknown,
) {
  return [
    {
      id: `AUD-${1043 + previous.length}`,
      action,
      entity,
      user,
      at: now(),
      before,
      after,
    },
    ...previous,
  ];
}

export function hasPermission(
  user: AppUser,
  groups: AccessGroup[],
  module: string,
  action: PermissionAction,
) {
  const group = groups.find((item) => item.id === user.groupId);
  if (!group || user.status !== "Ativo") return false;
  return Boolean(group.permissions[module]?.includes(action));
}

export function parseCsvReceivables(
  content: string,
  batchId: string,
): { receivables: Receivable[]; errors: string[] } {
  const normalized = content.trim();
  if (!normalized) return { receivables: [], errors: ["Arquivo vazio."] };

  const lines = normalized.split(/\r?\n/).filter(Boolean);
  const [headerLine, ...rows] = lines;
  const delimiter = headerLine.includes(";") ? ";" : ",";
  const headers = headerLine.split(delimiter).map((item) => item.trim().toLowerCase());
  const required = ["id", "cedente", "sacado", "emissao", "vencimento", "valor"];
  const missing = required.filter((field) => !headers.includes(field));
  if (missing.length) {
    return {
      receivables: [],
      errors: [`Colunas obrigatórias ausentes: ${missing.join(", ")}.`],
    };
  }

  const errors: string[] = [];
  const receivables: Receivable[] = [];
  rows.forEach((line, index) => {
    const values = line.split(delimiter).map((item) => item.trim());
    const row = Object.fromEntries(headers.map((header, position) => [header, values[position] ?? ""]));
    const value = Number(String(row.valor).replace(/\./g, "").replace(",", "."));
    if (!row.id || !row.cedente || !row.sacado || !row.vencimento || Number.isNaN(value)) {
      errors.push(`Linha ${index + 2}: dados obrigatórios inválidos.`);
      return;
    }
    receivables.push({
      id: row.id,
      ced: row.cedente,
      sac: row.sacado,
      emissao: row.emissao || now(),
      venc: row.vencimento,
      valor: value,
      status: "Importado",
      batchId,
    });
  });

  return { receivables, errors };
}

export function parseBrDate(value: string) {
  const [day, month, year] = value.split("/").map(Number);
  return new Date(year, month - 1, day);
}

export function diffDays(date: string, base = new Date(2026, 6, 7)) {
  const today = base;
  const due = parseBrDate(date);
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function estimateBusinessDays(calendarDays: number) {
  return Math.max(0, Math.ceil(calendarDays * (252 / 365)));
}

export function priceReceivable(
  receivable: Pick<Receivable, "valor" | "venc" | "status" | "confirmationStatus" | "debtorRating"> & Partial<Pick<Receivable, "sac">>,
  annualRate = DEFAULT_ACQUISITION_ANNUAL_RATE,
  serviceFeeBps = DEFAULT_SERVICE_FEE_BPS,
  debtor?: { rating?: string | null; statusConfirmacao?: string | null } | null,
): AcquisitionPricing {
  const calendarDays = Math.max(0, diffDays(receivable.venc));
  const businessDays = estimateBusinessDays(calendarDays);
  const riskAdjustments = buildPricingAdjustments(receivable, businessDays, debtor);
  const riskSpread = riskAdjustments.reduce((sum, item) => sum + item.rate, 0);
  const effectiveAnnualRate = annualRate + riskSpread;
  const discountFactor = Math.pow(1 + effectiveAnnualRate, businessDays / 252);
  const grossPurchasePrice = receivable.valor / discountFactor;
  const serviceFee = receivable.valor * (serviceFeeBps / 10_000);
  const purchasePrice = Math.max(0, grossPurchasePrice - serviceFee);
  const discount = receivable.valor - purchasePrice;
  const minimumPurchasePrice = receivable.valor * 0.5;
  const pricingSteps: AcquisitionPricing["pricingSteps"] = [
    {
      label: "Valor de face",
      value: receivable.valor,
      kind: "currency",
      formula: "Valor nominal do direito creditório",
    },
    {
      label: "Prazo estimado",
      value: businessDays,
      kind: "number",
      formula: "DU = dias corridos x 252 / 365",
      detail: `${calendarDays} dias corridos / ${businessDays} dias úteis`,
    },
    {
      label: "Taxa base anual",
      value: annualRate,
      kind: "percent",
      formula: "Taxa alvo informada pela mesa",
    },
    {
      label: "Spread de risco",
      value: riskSpread,
      kind: "percent",
      formula: "Soma dos ajustes por rating, confirmação, prazo e exceções",
      detail: riskAdjustments.map((item) => `${item.label}: ${fmtPct(item.rate)}`).join(" · ") || "Sem ajustes",
    },
    {
      label: "Taxa efetiva anual",
      value: effectiveAnnualRate,
      kind: "percent",
      formula: "Taxa base + spread de risco",
    },
    {
      label: "Fator de desconto",
      value: discountFactor,
      kind: "factor",
      formula: "(1 + taxa efetiva) ^ (DU / 252)",
    },
    {
      label: "Valor presente bruto",
      value: grossPurchasePrice,
      kind: "currency",
      formula: "Valor de face / fator de desconto",
    },
    {
      label: "Custos e tarifas",
      value: serviceFee,
      kind: "currency",
      formula: "Valor de face x bps / 10.000",
      detail: `${serviceFeeBps} bps`,
    },
    {
      label: "Preço líquido de compra",
      value: purchasePrice,
      kind: "currency",
      formula: "Valor presente bruto - custos e tarifas",
    },
    {
      label: "Deságio",
      value: discount / Math.max(receivable.valor, 1),
      kind: "percent",
      formula: "1 - preço líquido / valor de face",
      detail: fmt(discount),
    },
  ];
  const policyWarnings = [
    ...(purchasePrice <= 0 ? ["Preço líquido menor ou igual a zero."] : []),
    ...(purchasePrice < minimumPurchasePrice ? ["Preço líquido abaixo de 50% do valor de face."] : []),
    ...(discount / Math.max(receivable.valor, 1) > 0.35 ? ["Deságio acima de 35% requer validação executiva."] : []),
  ];

  return {
    faceValue: receivable.valor,
    baseAnnualRate: annualRate,
    annualRate: effectiveAnnualRate,
    calendarDays,
    businessDays,
    discountFactor,
    grossPurchasePrice,
    serviceFee,
    purchasePrice,
    discount,
    discountPercent: receivable.valor ? discount / receivable.valor : 0,
    riskSpread,
    riskAdjustments,
    pricingSteps,
    minimumPurchasePrice,
    policyWarnings,
  };
}

function buildPricingAdjustments(
  receivable: Pick<Receivable, "status" | "confirmationStatus" | "debtorRating">,
  businessDays: number,
  debtor?: { rating?: string | null; statusConfirmacao?: string | null } | null,
) {
  const rating = debtor?.rating ?? ("debtorRating" in receivable ? receivable.debtorRating : null) ?? "Sem rating";
  const confirmationStatus = receivable.confirmationStatus ?? debtor?.statusConfirmacao ?? "Pendente";
  const adjustments: AcquisitionPricing["riskAdjustments"] = [];

  const ratingSpread: Record<string, number> = {
    AAA: 0,
    AA: 0.005,
    A: 0.0125,
    BBB: 0.025,
    BB: 0.045,
    B: 0.075,
  };
  adjustments.push({
    label: "Rating do sacado",
    rate: ratingSpread[rating] ?? 0.1,
    reason: `Rating ${rating}`,
  });

  if (confirmationStatus === "Pendente") {
    adjustments.push({ label: "Confirmação pendente", rate: 0.015, reason: "Confirmação ainda pendente" });
  }
  if (confirmationStatus === "Sem resposta") {
    adjustments.push({ label: "Sem resposta do sacado", rate: 0.04, reason: "Contato sem resposta" });
  }
  if (confirmationStatus === "Divergente") {
    adjustments.push({ label: "Divergência de confirmação", rate: 0.12, reason: "Ativo deveria seguir para comitê/inelegibilidade" });
  }
  if (receivable.status === "Aprovado") {
    adjustments.push({ label: "Exceção aprovada", rate: 0.025, reason: "Ativo aprovado por comitê" });
  }
  if (businessDays > 60) {
    adjustments.push({ label: "Prazo longo", rate: 0.01, reason: "Prazo acima de 60 dias úteis" });
  }
  if (businessDays > 90) {
    adjustments.push({ label: "Prazo estendido", rate: 0.015, reason: "Prazo acima de 90 dias úteis" });
  }

  return adjustments.filter((item) => item.rate > 0);
}

export function evaluateReceivable(
  receivable: Receivable,
  assignors: Assignor[],
  debtors: Debtor[],
) {
  const assignor = assignors.find((item) => item.nome === receivable.ced);
  const debtor = debtors.find((item) => item.nome === receivable.sac);
  const days = diffDays(receivable.venc);
  const debtorConfirmationStatus = receivable.confirmationStatus ?? debtor?.statusConfirmacao ?? "Pendente";
  const debtorConfirmationContact =
    debtor?.emailConfirmacao ||
    debtor?.telefoneConfirmacao ||
    debtor?.contatoFinanceiroEmail ||
    debtor?.contatoFinanceiroTelefone;
  const debtorConfirmationHardFail = ["Divergente", "Bloqueado"].includes(debtorConfirmationStatus);
  const checks: EligibilityCheck[] = [
    {
      rule: "Cedente ativo",
      passed: assignor?.status === "Ativo",
      message: assignor ? `Status ${assignor.status}` : "Cedente não cadastrado",
    },
    {
      rule: "Sacado ativo",
      passed: debtor?.status === "Ativo",
      message: debtor ? `Status ${debtor.status}` : "Sacado não cadastrado",
    },
    {
      rule: "Prazo máximo 120 dias",
      passed: days > 0 && days <= 120,
      message: `${days} dias até o vencimento`,
    },
    {
      rule: "Valor mínimo R$ 1 mil",
      passed: receivable.valor >= 1000,
      message: fmt(receivable.valor),
    },
    {
      rule: "Rating mínimo BBB",
      passed: Boolean(debtor && ["AAA", "AA", "A", "BBB"].includes(debtor.rating)),
      message: debtor?.rating ?? "Sem rating",
    },
    {
      rule: "Contato de confirmação do sacado",
      passed: Boolean(debtor && debtorConfirmationContact),
      message: debtor
        ? debtorConfirmationContact
          ? String(debtorConfirmationContact)
          : "Sem contato financeiro ou canal de confirmação"
        : "Sacado nÃ£o cadastrado",
    },
    {
      rule: "Status de confirmação do sacado",
      passed: Boolean(debtor && ["Confirmado", "Dispensado"].includes(debtorConfirmationStatus)),
      message: debtor ? `Confirmação ${debtorConfirmationStatus}` : "Sacado não cadastrado",
    },
    {
      rule: "Limite do cedente disponível",
      passed: Boolean(assignor && assignor.exposicao + receivable.valor <= assignor.limite),
      message: assignor
        ? `${fmt(assignor.exposicao + receivable.valor)} / ${fmt(assignor.limite)}`
        : "Sem limite cadastrado",
    },
  ];

  const passed = checks.filter((check) => check.passed).length;
  const score = Math.round((passed / checks.length) * 100);
  const status: ReceivableStatus = debtorConfirmationHardFail ? "Inelegível" : checks.every((check) => check.passed)
    ? "Elegível"
    : score >= 70
      ? "Revisão"
      : "Inelegível";

  return { status, checks, score };
}

export function runEligibility(
  receivables: Receivable[],
  assignors: Assignor[],
  debtors: Debtor[],
) {
  return receivables.map((receivable) => {
    if (receivable.status === "Comprado" || receivable.status === "Liquidado") return receivable;
    const eligibility = evaluateReceivable(receivable, assignors, debtors);
    return { ...receivable, status: eligibility.status, eligibility };
  });
}

export function buildDemoCsv() {
  return [
    "id;cedente;sacado;emissao;vencimento;valor",
    "DPL-90514;Grupo Monte Azul;Rede Nacional de Varejo S.A.;07/07/2026;30/09/2026;535000",
    "DPL-90515;Alvorada Alimentos S.A.;Distribuidora Horizonte Ltda.;07/07/2026;15/10/2026;420000",
    "DPL-90516;Nexum Tecnologia Ltda.;Mercantil Paulista S.A.;07/07/2026;20/12/2026;88000",
  ].join("\n");
}
