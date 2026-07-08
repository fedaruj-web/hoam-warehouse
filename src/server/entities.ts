import type { Assignor, Audit, BankStatementEntry, CashAccount, CashMovement, Debtor, DocumentRecord, FundingIssue, ImportBatch, Receivable } from "@/lib/types";
import { entityStatusToPrisma, entityStatusToUi } from "@/lib/status-map";

type PrismaAssignor = {
  code: string;
  legalName: string;
  tradeName?: string | null;
  taxId: string;
  stateRegistration?: string | null;
  municipalRegistration?: string | null;
  foundationDate?: Date | null;
  sector: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  economicGroup?: string | null;
  annualRevenue?: { toNumber?: () => number } | number | null;
  employeeCount?: number | null;
  creditLimit: { toNumber?: () => number } | number;
  relationshipManager?: string | null;
  onboardingStage?: string | null;
  complianceStatus?: string | null;
  kycStatus?: string | null;
  sanctionScreening?: string | null;
  pepExposure?: string | null;
  complianceNotes?: string | null;
  lastComplianceReview?: Date | null;
  representatives?: unknown;
  ultimateBeneficialOwners?: unknown;
  portalUsers?: {
    id: string;
    name: string;
    email: string;
    status: string;
    role: string;
    createdAt: Date;
  }[];
  status: string;
  deletedAt?: Date | null;
};

type PrismaDebtor = {
  code: string;
  legalName: string;
  tradeName?: string | null;
  taxId: string;
  rating: string | null;
  exposureLimit: { toNumber?: () => number } | number | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  addressLine?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  financialContactName?: string | null;
  financialContactRole?: string | null;
  financialContactEmail?: string | null;
  financialContactPhone?: string | null;
  confirmationEmail?: string | null;
  confirmationPhone?: string | null;
  confirmationChannel?: string | null;
  confirmationWindow?: string | null;
  confirmationStatus?: string | null;
  lastConfirmationAt?: Date | null;
  confirmationNotes?: string | null;
  relationshipEvidence?: string | null;
  protestHistory?: string | null;
  paymentBehavior?: string | null;
  operationalNotes?: string | null;
  status: string;
  deletedAt?: Date | null;
};

type PrismaAudit = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: Date;
  before?: unknown;
  after?: unknown;
  user?: { name: string } | null;
};

type PrismaBatch = {
  code: string;
  fileName: string;
  status: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createdAt: Date;
};

type PrismaReceivable = {
  externalId: string;
  issueDate: Date;
  dueDate: Date;
  faceValue: { toNumber?: () => number } | number;
  purchasePrice?: { toNumber?: () => number } | number | null;
  status: string;
  confirmationStatus?: string | null;
  confirmationChannel?: string | null;
  confirmationEvidence?: string | null;
  confirmationNotes?: string | null;
  confirmedAt?: Date | null;
  confirmedById?: string | null;
  deletedAt?: Date | null;
  batch?: { code: string } | null;
  assignor?: { legalName: string } | null;
  debtor?: { legalName: string; rating?: string | null } | null;
  portfolio?: {
    acquisitionValue: { toNumber?: () => number } | number;
    outstandingValue: { toNumber?: () => number } | number;
    status: string;
  } | null;
};


type PrismaCashMovement = {
  code: string;
  accountId?: string | null;
  account?: { code: string; name: string } | null;
  date: Date;
  description: string;
  type: string;
  amount: { toNumber?: () => number } | number;
  reference?: string | null;
};

type PrismaCashAccount = {
  code: string;
  name: string;
  bankName?: string | null;
  branch?: string | null;
  accountNumber?: string | null;
  accountType: string;
  purpose: string;
  currency: string;
  openingBalance: { toNumber?: () => number } | number;
  status: string;
  deletedAt?: Date | null;
  movements?: PrismaCashMovement[];
};

type PrismaBankStatementEntry = {
  code: string;
  account?: { code: string; name: string } | null;
  cashMovement?: { code: string } | null;
  statementDate: Date;
  description: string;
  type: string;
  amount: { toNumber?: () => number } | number;
  reference?: string | null;
  status: string;
  notes?: string | null;
};

type PrismaFundingIssue = {
  code: string;
  instrument: string;
  amount: { toNumber?: () => number } | number;
  rate: string;
  maturity?: Date | null;
  status: string;
};
type PrismaDocument = {
  code: string;
  name: string;
  type: string;
  status: string;
  stage?: string | null;
  requirement?: string | null;
  sizeBytes?: number | null;
  expiresAt?: Date | null;
  createdAt: Date;
  storageKey?: string | null;
  receivable?: { externalId: string } | null;
  purchase?: { code: string } | null;
};

function decimalToNumber(value: PrismaAssignor["creditLimit"] | PrismaDebtor["exposureLimit"] | PrismaAssignor["annualRevenue"]) {
  if (value == null) return 0;
  return typeof value === "number" ? value : value.toNumber?.() ?? Number(value);
}

function moneyToNumber(value: { toNumber?: () => number } | number | null | undefined) {
  if (value == null) return undefined;
  return typeof value === "number" ? value : value.toNumber?.() ?? Number(value);
}

function formatDate(date: Date) {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function mapAssignor(item: PrismaAssignor): Assignor {
  return {
    id: item.code,
    nome: item.legalName,
    nomeFantasia: item.tradeName ?? null,
    doc: item.taxId,
    inscricaoEstadual: item.stateRegistration ?? null,
    inscricaoMunicipal: item.municipalRegistration ?? null,
    fundacao: item.foundationDate ? formatDate(item.foundationDate) : null,
    setor: item.sector ?? "Não informado",
    site: item.website ?? null,
    email: item.email ?? null,
    telefone: item.phone ?? null,
    endereco: item.addressLine ?? null,
    cidade: item.addressCity ?? null,
    uf: item.addressState ?? null,
    grupoEconomico: item.economicGroup ?? null,
    receitaAnual: item.annualRevenue == null ? null : decimalToNumber(item.annualRevenue),
    funcionarios: item.employeeCount ?? null,
    limite: decimalToNumber(item.creditLimit),
    exposicao: 0,
    gerenteRelacionamento: item.relationshipManager ?? null,
    etapaOnboarding: item.onboardingStage ?? "Cadastro inicial",
    complianceStatus: item.complianceStatus ?? "Pendente",
    kycStatus: item.kycStatus ?? "Pendente",
    consultaSancoes: item.sanctionScreening ?? "Não consultado",
    exposicaoPep: item.pepExposure ?? "Não informado",
    parecerCompliance: item.complianceNotes ?? null,
    ultimaRevisaoCompliance: item.lastComplianceReview ? formatDate(item.lastComplianceReview) : null,
    procuradores: Array.isArray(item.representatives) ? item.representatives : [],
    beneficiariosFinais: Array.isArray(item.ultimateBeneficialOwners) ? item.ultimateBeneficialOwners : [],
    portalUsers: item.portalUsers?.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status === "ACTIVE" ? "Ativo" : user.status === "BLOCKED" ? "Bloqueado" : "Convite pendente",
      role: user.role,
      createdAt: formatDate(user.createdAt),
    })) ?? [],
    status: entityStatusToUi(item.status),
    deletedAt: item.deletedAt?.toISOString() ?? null,
  };
}

export function mapDebtor(item: PrismaDebtor): Debtor {
  return {
    id: item.code,
    nome: item.legalName,
    nomeFantasia: item.tradeName ?? null,
    doc: item.taxId,
    rating: item.rating ?? "Sem rating",
    valor: decimalToNumber(item.exposureLimit),
    email: item.email ?? null,
    telefone: item.phone ?? null,
    site: item.website ?? null,
    endereco: item.addressLine ?? null,
    cidade: item.addressCity ?? null,
    uf: item.addressState ?? null,
    contatoFinanceiroNome: item.financialContactName ?? null,
    contatoFinanceiroCargo: item.financialContactRole ?? null,
    contatoFinanceiroEmail: item.financialContactEmail ?? null,
    contatoFinanceiroTelefone: item.financialContactPhone ?? null,
    emailConfirmacao: item.confirmationEmail ?? null,
    telefoneConfirmacao: item.confirmationPhone ?? null,
    canalConfirmacao: item.confirmationChannel ?? "E-mail",
    janelaConfirmacao: item.confirmationWindow ?? null,
    statusConfirmacao: item.confirmationStatus ?? "Pendente",
    ultimaConfirmacao: item.lastConfirmationAt ? formatDate(item.lastConfirmationAt) : null,
    observacaoConfirmacao: item.confirmationNotes ?? null,
    evidenciaRelacionamento: item.relationshipEvidence ?? null,
    historicoProtestos: item.protestHistory ?? null,
    comportamentoPagamento: item.paymentBehavior ?? null,
    observacoesOperacionais: item.operationalNotes ?? null,
    status: entityStatusToUi(item.status),
    deletedAt: item.deletedAt?.toISOString() ?? null,
  };
}

export function mapAudit(item: PrismaAudit): Audit {
  return {
    id: item.id,
    action: item.action,
    entity: `${item.entityType}:${item.entityId}`,
    user: item.user?.name ?? "Sistema",
    at: item.createdAt.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    before: item.before,
    after: item.after,
  };
}

const receivableStatusToUi: Record<string, Receivable["status"]> = {
  IMPORTED: "Importado",
  ELIGIBLE: "Elegível",
  REVIEW: "Revisão",
  INELIGIBLE: "Inelegível",
  APPROVED: "Aprovado",
  PURCHASED: "Comprado",
  SETTLED: "Liquidado",
  OVERDUE: "Vencido",
  CANCELLED: "Inelegível",
};

export const receivableStatusToPrisma: Record<string, string> = {
  "Importado": "IMPORTED",
  "Elegível": "ELIGIBLE",
  "Revisão": "REVIEW",
  "Inelegível": "INELIGIBLE",
  "Aprovado": "APPROVED",
  "Comprado": "PURCHASED",
  "Liquidado": "SETTLED",
  "Vencido": "OVERDUE",
};

export function mapBatch(item: PrismaBatch): ImportBatch {
  return {
    id: item.code,
    fileName: item.fileName,
    status: item.status as ImportBatch["status"],
    totalRows: item.totalRows,
    validRows: item.validRows,
    invalidRows: item.invalidRows,
    createdAt: item.createdAt.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

export function mapReceivable(item: PrismaReceivable): Receivable {
  return {
    id: item.externalId,
    ced: item.assignor?.legalName ?? "Cedente não informado",
    sac: item.debtor?.legalName ?? "Sacado não informado",
    debtorRating: item.debtor?.rating ?? null,
    emissao: formatDate(item.issueDate),
    venc: formatDate(item.dueDate),
    valor: moneyToNumber(item.faceValue) ?? 0,
    preco: moneyToNumber(item.purchasePrice),
    acquisitionValue: moneyToNumber(item.portfolio?.acquisitionValue),
    outstandingValue: moneyToNumber(item.portfolio?.outstandingValue),
    portfolioStatus: item.portfolio?.status ?? null,
    status: receivableStatusToUi[item.status] ?? "Importado",
    confirmationStatus: item.confirmationStatus ?? "Pendente",
    confirmationChannel: item.confirmationChannel ?? "E-mail",
    confirmationEvidence: item.confirmationEvidence ?? null,
    confirmationNotes: item.confirmationNotes ?? null,
    confirmedAt: item.confirmedAt ? formatDate(item.confirmedAt) : null,
    confirmedById: item.confirmedById ?? null,
    batchId: item.batch?.code,
    deletedAt: item.deletedAt?.toISOString() ?? null,
  };
}

const documentTypeToUi: Record<string, DocumentRecord["type"]> = {
  CONTRACT: "Contrato",
  COLLATERAL: "Lastro",
  RECEIPT: "Comprovante",
  KYC: "KYC",
  BORDER: "Borderô",
  COMMITTEE: "Comitê",
  PAYMENT: "Pagamento",
  POWER_OF_ATTORNEY: "Procuração",
};

export const documentTypeToPrisma: Record<string, string> = {
  "Contrato": "CONTRACT",
  "Lastro": "COLLATERAL",
  "Comprovante": "RECEIPT",
  "KYC": "KYC",
  "Borderô": "BORDER",
  "Bordero": "BORDER",
  "Comitê": "COMMITTEE",
  "Comite": "COMMITTEE",
  "Pagamento": "PAYMENT",
  "Procuração": "POWER_OF_ATTORNEY",
  "Procuracao": "POWER_OF_ATTORNEY",
};

const documentStatusToUi: Record<string, DocumentRecord["status"]> = {
  PENDING: "Pendente",
  VALID: "Válido",
  EXPIRED: "Vencido",
  REVIEW: "Em revisão",
};

export const documentStatusToPrisma: Record<string, string> = {
  "Pendente": "PENDING",
  "Válido": "VALID",
  "Valido": "VALID",
  "Vencido": "EXPIRED",
  "Em revisão": "REVIEW",
  "Em revisao": "REVIEW",
};

function formatBytes(value?: number | null) {
  if (!value) return "Metadado";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

export function mapDocument(item: PrismaDocument, entityLabel?: string | null): DocumentRecord {
  return {
    id: item.code,
    name: item.name,
    type: documentTypeToUi[item.type] ?? "Comprovante",
    entity: entityLabel ?? item.receivable?.externalId ?? item.purchase?.code ?? item.storageKey ?? "Sem vínculo",
    status: documentStatusToUi[item.status] ?? "Pendente",
    stage: item.stage ?? null,
    requirement: item.requirement ?? null,
    expiresAt: item.expiresAt ? formatDate(item.expiresAt) : null,
    uploadedAt: item.createdAt.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    size: formatBytes(item.sizeBytes),
  };
}

export function toPrismaStatus(status: string) {
  return entityStatusToPrisma(status);
}

export function mapCashMovement(item: PrismaCashMovement): CashMovement {
  return {
    id: item.code,
    accountId: item.account?.code ?? item.accountId ?? null,
    accountName: item.account?.name ?? null,
    date: formatDate(item.date),
    description: item.description,
    type: item.type === "OUTFLOW" ? "Saída" : "Entrada",
    amount: moneyToNumber(item.amount) ?? 0,
    reference: item.reference ?? null,
  };
}

export function mapCashAccount(item: PrismaCashAccount): CashAccount {
  const openingBalance = moneyToNumber(item.openingBalance) ?? 0;
  const movementBalance = item.movements?.reduce((sum, movement) => {
    const amount = moneyToNumber(movement.amount) ?? 0;
    return sum + (movement.type === "OUTFLOW" ? -amount : amount);
  }, 0) ?? 0;
  return {
    id: item.code,
    name: item.name,
    bankName: item.bankName ?? null,
    branch: item.branch ?? null,
    accountNumber: item.accountNumber ?? null,
    accountType: item.accountType,
    purpose: item.purpose,
    currency: item.currency,
    openingBalance,
    balance: openingBalance + movementBalance,
    status: item.status,
    deletedAt: item.deletedAt?.toISOString() ?? null,
  };
}

export function mapBankStatementEntry(item: PrismaBankStatementEntry): BankStatementEntry {
  return {
    id: item.code,
    accountId: item.account?.code ?? "",
    accountName: item.account?.name ?? null,
    cashMovementId: item.cashMovement?.code ?? null,
    date: formatDate(item.statementDate),
    description: item.description,
    type: item.type === "OUTFLOW" ? "Saída" : "Entrada",
    amount: moneyToNumber(item.amount) ?? 0,
    reference: item.reference ?? null,
    status: item.status,
    notes: item.notes ?? null,
  };
}

export function mapFundingIssue(item: PrismaFundingIssue): FundingIssue {
  const statusMap: Record<string, FundingIssue["status"]> = {
    STRUCTURING: "Estruturando",
    ISSUED: "Emitido",
    SETTLED: "Liquidado",
  };
  return {
    id: item.code,
    instrument: item.instrument,
    amount: moneyToNumber(item.amount) ?? 0,
    rate: item.rate,
    maturity: item.maturity ? formatDate(item.maturity) : "Sem vencimento",
    status: statusMap[item.status] ?? "Estruturando",
  };
}

export const fundingStatusToPrisma: Record<string, string> = {
  "Estruturando": "STRUCTURING",
  "Emitido": "ISSUED",
  "Liquidado": "SETTLED",
};

