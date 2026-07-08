export type View =
  | "dashboard"
  | "alertas"
  | "esteira"
  | "cedentes"
  | "sacados"
  | "importacao"
  | "confirmacao"
  | "elegibilidade"
  | "risco"
  | "comite"
  | "compra"
  | "carteira"
  | "caixa"
  | "cobranca"
  | "funding"
  | "documentos"
  | "relatorios"
  | "usuarios";

export type Modal =
  | null
  | "cedente"
  | "cedente-edit"
  | "cedente-portal-user"
  | "sacado"
  | "sacado-edit"
  | "upload"
  | "confirmacao"
  | "comite"
  | "liquidacao"
  | "conta-caixa"
  | "movimento-caixa"
  | "extrato-bancario"
  | "funding"
  | "usuario"
  | "documento"
  | "detalhe";

export type PermissionAction = "view" | "create" | "approve" | "purchase" | "admin";
export type PermissionMap = Record<string, PermissionAction[]>;

export type EntityStatus = "Ativo" | "Em análise" | "Monitorar" | "Bloqueado" | "Inativo";
export type ReceivableStatus =
  | "Importado"
  | "Elegível"
  | "Revisão"
  | "Inelegível"
  | "Aprovado"
  | "Comprado"
  | "Liquidado"
  | "Vencido";

export type Assignor = {
  id: string;
  nome: string;
  nomeFantasia?: string | null;
  doc: string;
  inscricaoEstadual?: string | null;
  inscricaoMunicipal?: string | null;
  fundacao?: string | null;
  setor: string;
  site?: string | null;
  email?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  cidade?: string | null;
  uf?: string | null;
  grupoEconomico?: string | null;
  receitaAnual?: number | null;
  funcionarios?: number | null;
  limite: number;
  exposicao: number;
  gerenteRelacionamento?: string | null;
  etapaOnboarding?: string | null;
  complianceStatus?: string | null;
  kycStatus?: string | null;
  consultaSancoes?: string | null;
  exposicaoPep?: string | null;
  parecerCompliance?: string | null;
  ultimaRevisaoCompliance?: string | null;
  procuradores?: AssignorRepresentative[];
  beneficiariosFinais?: AssignorBeneficialOwner[];
  portalUsers?: AssignorPortalUser[];
  status: EntityStatus;
  deletedAt?: string | null;
};

export type AssignorPortalUser = {
  id: string;
  name: string;
  email: string;
  status: "Ativo" | "Convite pendente" | "Bloqueado" | string;
  role: string;
  createdAt: string;
};

export type AssignorRepresentative = {
  nome: string;
  cpf: string;
  cargo: string;
  email: string;
  telefone: string;
  poderes: string;
  validadeMandato: string;
};

export type AssignorBeneficialOwner = {
  nome: string;
  cpf: string;
  participacao: number;
  pep: string;
};

export type Debtor = {
  id: string;
  nome: string;
  nomeFantasia?: string | null;
  doc: string;
  rating: string;
  valor: number;
  email?: string | null;
  telefone?: string | null;
  site?: string | null;
  endereco?: string | null;
  cidade?: string | null;
  uf?: string | null;
  contatoFinanceiroNome?: string | null;
  contatoFinanceiroCargo?: string | null;
  contatoFinanceiroEmail?: string | null;
  contatoFinanceiroTelefone?: string | null;
  emailConfirmacao?: string | null;
  telefoneConfirmacao?: string | null;
  canalConfirmacao?: string | null;
  janelaConfirmacao?: string | null;
  statusConfirmacao?: string | null;
  ultimaConfirmacao?: string | null;
  observacaoConfirmacao?: string | null;
  evidenciaRelacionamento?: string | null;
  historicoProtestos?: string | null;
  comportamentoPagamento?: string | null;
  observacoesOperacionais?: string | null;
  status: EntityStatus;
  deletedAt?: string | null;
};

export type Receivable = {
  id: string;
  ced: string;
  sac: string;
  debtorRating?: string | null;
  emissao: string;
  venc: string;
  valor: number;
  preco?: number;
  acquisitionValue?: number | null;
  outstandingValue?: number | null;
  portfolioStatus?: string | null;
  pricing?: AcquisitionPricing;
  status: ReceivableStatus;
  confirmationStatus?: "Pendente" | "Confirmado" | "Divergente" | "Sem resposta" | "Dispensado" | string;
  confirmationChannel?: string | null;
  confirmationEvidence?: string | null;
  confirmationNotes?: string | null;
  confirmedAt?: string | null;
  confirmedById?: string | null;
  batchId?: string;
  deletedAt?: string | null;
  eligibility?: EligibilityResult;
};

export type EligibilityCheck = {
  rule: string;
  passed: boolean;
  message: string;
};

export type EligibilityResult = {
  status: ReceivableStatus;
  checks: EligibilityCheck[];
  score: number;
};

export type AcquisitionPricing = {
  faceValue: number;
  baseAnnualRate: number;
  annualRate: number;
  calendarDays: number;
  businessDays: number;
  discountFactor: number;
  grossPurchasePrice: number;
  serviceFee: number;
  purchasePrice: number;
  discount: number;
  discountPercent: number;
  riskSpread: number;
  riskAdjustments: PricingAdjustment[];
  pricingSteps: PricingStep[];
  minimumPurchasePrice: number;
  policyWarnings: string[];
};

export type PricingAdjustment = {
  label: string;
  rate: number;
  reason: string;
};

export type PricingStep = {
  label: string;
  value: number;
  kind: "currency" | "percent" | "number" | "factor";
  formula: string;
  detail?: string;
};

export type ImportBatch = {
  id: string;
  fileName: string;
  status: "Recebido" | "Validado" | "Com erros" | "Processado";
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createdAt: string;
};

export type AccessGroup = {
  id: string;
  name: string;
  description: string;
  users: number;
  permissions: PermissionMap;
};

export type AppUser = {
  id: string;
  name: string;
  email: string;
  groupId: string;
  status: "Ativo" | "Convite pendente" | "Bloqueado";
  lastAccess: string;
};

export type Audit = {
  id: string;
  action: string;
  entity: string;
  user: string;
  at: string;
  before?: unknown;
  after?: unknown;
};

export type DocumentRecord = {
  id: string;
  name: string;
  type: "Contrato" | "Lastro" | "Comprovante" | "KYC" | "Borderô" | "Comitê" | "Pagamento" | "Procuração";
  entity: string;
  status: "Pendente" | "Válido" | "Vencido" | "Em revisão";
  stage?: string | null;
  requirement?: string | null;
  expiresAt?: string | null;
  uploadedAt: string;
  size: string;
};

export type DocumentChecklist = {
  receivableId: string;
  assignor: string;
  debtor: string;
  status: string;
  required: { requirement: string; label: string; type: string }[];
  gaps: { requirement: string; label: string; type: string }[];
  ok: boolean;
};

export type CashMovement = {
  id: string;
  accountId?: string | null;
  accountName?: string | null;
  date: string;
  description: string;
  type: "Entrada" | "Saída";
  amount: number;
  reference?: string | null;
};

export type CashAccount = {
  id: string;
  name: string;
  bankName?: string | null;
  branch?: string | null;
  accountNumber?: string | null;
  accountType: string;
  purpose: string;
  currency: string;
  openingBalance: number;
  balance: number;
  status: string;
  deletedAt?: string | null;
};

export type BankStatementEntry = {
  id: string;
  accountId: string;
  accountName?: string | null;
  cashMovementId?: string | null;
  date: string;
  description: string;
  type: "Entrada" | "Saída";
  amount: number;
  reference?: string | null;
  status: "Pendente" | "Conciliado" | "Divergente" | string;
  notes?: string | null;
};

export type FundingIssue = {
  id: string;
  instrument: string;
  amount: number;
  rate: string;
  maturity: string;
  status: "Estruturando" | "Emitido" | "Liquidado";
};


