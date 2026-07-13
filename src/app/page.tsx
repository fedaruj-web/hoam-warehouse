"use client";

import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import {
  Bell,
  AlertTriangle,
  Banknote,
  BriefcaseBusiness,
  Building2,
  Check,
  ClipboardCheck,
  FileText,
  FileUp,
  Gavel,
  KeyRound,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Plus,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  TrendingUp,
  UploadCloud,
  Users,
  BarChart3,
} from "lucide-react";
import {
  actions,
  assignorsSeed,
  auditsSeed,
  batchesSeed,
  bankStatementSeed,
  cashAccountsSeed,
  cashSeed,
  debtorsSeed,
  documentsSeed,
  fundingSeed,
  groupsSeed,
  modules,
  receivablesSeed,
  usersSeed,
} from "@/lib/mock-data";
import {
  DEFAULT_ACQUISITION_ANNUAL_RATE,
  DEFAULT_SERVICE_FEE_BPS,
  buildDemoCsv,
  createAudit,
  diffDays,
  fmt,
  fmtPct,
  hasPermission,
  now,
  parseCsvReceivables,
  priceReceivable,
  runEligibility,
} from "@/lib/domain";
import type {
  AccessGroup,
  AppUser,
  Assignor,
  Audit,
  CashAccount,
  CashMovement,
  CessionOperation,
  BankStatementEntry,
  Debtor,
  DocumentRecord,
  DocumentChecklist,
  FundingIssue,
  ImportBatch,
  Modal,
  PermissionAction,
  Receivable,
  View,
  AcquisitionPricing,
} from "@/lib/types";

const viewModule: Record<View, string> = {
  dashboard: "Dashboard",
  alertas: "Alertas",
  esteira: "Esteira",
  cedentes: "Cedentes",
  sacados: "Sacados",
  jornada: "Compra",
  importacao: "Importação",
  confirmacao: "Confirmação",
  elegibilidade: "Elegibilidade",
  risco: "Risco",
  comite: "Comitê",
  compra: "Compra",
  carteira: "Carteira",
  caixa: "Caixa",
  cobranca: "Cobrança",
  funding: "Funding",
  documentos: "Documentos",
  relatorios: "Relatórios",
  usuarios: "Usuários",
};

type ConfirmationLinkState = {
  link: string;
  expiresAt: string;
  recipientEmail: string | null;
  emailStatus: string | null;
  emailError: string | null;
  emailSentAt: string | null;
  emailLastAttemptAt: string | null;
  emailAttempts: number;
};

const info: Record<View, [string, string, string]> = {
  dashboard: ["VISÃO GERAL", "Dashboard executivo", "Visão consolidada da operação warehouse"],
  alertas: ["COMANDO", "Alertas e pendências", "Fila executiva de risco, documentos, caixa e operação"],
  esteira: ["OPERAÇÕES", "Esteira operacional", "Funil guiado do ciclo de vida dos direitos creditórios"],
  cedentes: ["ORIGINAÇÃO", "Cedentes", "Gestão de originadores e limites de crédito"],
  sacados: ["CRÉDITO", "Sacados", "Gestão de devedores e concentração de risco"],
  jornada: ["CAPITAL FLOW", "Jornada de cessão", "Fluxo guiado da simulação à entrada na carteira warehouse"],
  importacao: ["OPERAÇÕES", "Importação de duplicatas", "Envie, valide e processe novos lotes"],
  confirmacao: ["OPERAÇÕES", "Confirmação de duplicatas", "Registro de aceite, divergência e evidências por ativo"],
  elegibilidade: ["RISCO", "Motor de elegibilidade", "Validação automática conforme políticas vigentes"],
  risco: ["RISCO", "Risco e Covenants", "Concentração, limites, cobertura de funding e alertas da carteira"],
  comite: ["GOVERNANÇA", "Comitê de crédito", "Aprovação de exceções, reprovações e solicitações de ajuste"],
  compra: ["OPERAÇÕES", "Compra de ativos", "Formalização e liquidação de direitos creditórios"],
  carteira: ["PORTFÓLIO", "Carteira warehouse", "Posição consolidada dos ativos adquiridos"],
  caixa: ["TESOURARIA", "Contas e Caixa", "Contas operacionais do warehouse, saldos e movimentações"],
  cobranca: ["PORTFÓLIO", "Cobrança e liquidação", "Recebimentos, vencidos e eventos de cobrança da carteira"],
  funding: ["CAPITAL", "Funding e emissões", "Captação, emissões e capacidade de financiamento do warehouse"],
  documentos: ["GOVERNANÇA", "Gestão de documentos", "Contratos, lastro, KYC e comprovantes vinculados"],
  relatorios: ["INTELIGÊNCIA", "Relatórios", "Caixa, funding, exposição e trilhas operacionais"],
  usuarios: ["ADMINISTRAÇÃO", "Usuários e permissões", "Perfis de acesso, grupos e segregação de funções"],
};

type PurchaseReadinessCheck = {
  label: string;
  detail: string;
  passed: boolean;
  critical?: boolean;
};

type PurchaseReadiness = {
  status: "Pronto" | "Pendente" | "Override requerido";
  checks: PurchaseReadinessCheck[];
  blockers: PurchaseReadinessCheck[];
  warnings: PurchaseReadinessCheck[];
};

const investmentGradeRatings = ["AAA", "AA", "A", "BBB"];
const validConfirmationStatuses = ["Confirmado", "Dispensado"];

function buildPurchaseReadiness(
  item: Receivable,
  pricing: AcquisitionPricing,
  assignors: Assignor[],
  debtors: Debtor[],
  documentChecklists: DocumentChecklist[],
  cashAccounts: CashAccount[],
): PurchaseReadiness {
  const assignor = assignors.find((entity) => entity.nome === item.ced && !entity.deletedAt);
  const debtor = debtors.find((entity) => entity.nome === item.sac && !entity.deletedAt);
  const documents = documentChecklists.find((checklist) => checklist.receivableId === item.id);
  const dueDays = diffDays(item.venc);
  const purchaseAccount = cashAccounts.find((account) => account.purpose === "PURCHASE_SETTLEMENT" && account.status === "Ativa" && !account.deletedAt);
  const confirmationStatus = item.confirmationStatus ?? "Pendente";
  const hasManualConfirmationBasis = validConfirmationStatuses.includes(confirmationStatus) || Boolean(item.confirmationNotes?.trim());
  const assignorExposureAfterPurchase = (assignor?.exposicao ?? 0) + item.valor;
  const withinAssignorLimit = Boolean(assignor) && assignorExposureAfterPurchase <= (assignor?.limite ?? 0);
  const discountNeedsCommittee = pricing.discountPercent > 0.35;

  const checks: PurchaseReadinessCheck[] = [
    {
      label: "Cedente ativo",
      passed: assignor?.status === "Ativo",
      critical: true,
      detail: assignor ? `Status cadastral: ${assignor.status}` : "Cedente não localizado no cadastro",
    },
    {
      label: "Sacado ativo",
      passed: debtor?.status === "Ativo",
      critical: true,
      detail: debtor ? `Status cadastral: ${debtor.status}` : "Sacado não localizado no cadastro",
    },
    {
      label: "Confirmação registrada",
      passed: hasManualConfirmationBasis,
      critical: true,
      detail: hasManualConfirmationBasis ? `${confirmationStatus} · ${item.confirmationChannel ?? "manual"}` : "Sem confirmação, dispensa ou justificativa manual",
    },
    {
      label: "Documentos mínimos",
      passed: Boolean(documents?.ok),
      critical: true,
      detail: documents?.ok ? "Checklist documental completo" : `${documents?.gaps.length ?? 0} pendência(s) documentais`,
    },
    {
      label: "Elegibilidade",
      passed: ["Elegível", "Aprovado", "Comprado"].includes(item.status),
      critical: true,
      detail: item.status === "Aprovado" ? "Liberado por comitê" : `Status atual: ${item.status}`,
    },
    {
      label: "Limite do cedente",
      passed: withinAssignorLimit,
      critical: true,
      detail: assignor ? `Exposição após compra: ${fmt(assignorExposureAfterPurchase)} / ${fmt(assignor.limite)}` : "Limite indisponível",
    },
    {
      label: "Rating do sacado",
      passed: investmentGradeRatings.includes(debtor?.rating ?? item.debtorRating ?? ""),
      critical: true,
      detail: `Rating: ${debtor?.rating ?? item.debtorRating ?? "sem rating"}`,
    },
    {
      label: "Prazo do ativo",
      passed: dueDays > 0 && dueDays <= 120,
      critical: true,
      detail: dueDays > 0 ? `${dueDays} dias corridos até vencimento` : "Ativo vencido",
    },
    {
      label: "Preço de aquisição",
      passed: pricing.purchasePrice > 0 && pricing.purchasePrice >= pricing.minimumPurchasePrice,
      critical: true,
      detail: pricing.policyWarnings[0] ?? `Preço líquido: ${fmt(pricing.purchasePrice)}`,
    },
    {
      label: "Conta de liquidação",
      passed: Boolean(purchaseAccount),
      critical: true,
      detail: purchaseAccount ? purchaseAccount.name : "Configure uma conta ativa para PURCHASE_SETTLEMENT",
    },
    {
      label: "Alçada de exceção",
      passed: !discountNeedsCommittee || item.status === "Aprovado",
      critical: true,
      detail: discountNeedsCommittee ? "Deságio acima de 35% exige comitê" : "Sem exceção de deságio",
    },
  ];

  const blockers = checks.filter((check) => check.critical && !check.passed);
  const warnings = checks.filter((check) => !check.critical && !check.passed);
  const hasCommitteeOverride = item.status === "Aprovado" && blockers.some((check) => check.label === "Alçada de exceção");

  return {
    status: blockers.length ? (hasCommitteeOverride ? "Override requerido" : "Pendente") : "Pronto",
    checks,
    blockers,
    warnings,
  };
}

function formatPricingStepValue(step: AcquisitionPricing["pricingSteps"][number]) {
  if (step.kind === "currency") return fmt(step.value);
  if (step.kind === "percent") return fmtPct(step.value);
  if (step.kind === "factor") return step.value.toFixed(6);
  return step.value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function estimateFundingCost(rate: string) {
  const normalized = rate.replace(",", ".");
  const match = normalized.match(/(-?\d+(\.\d+)?)/);
  const value = match ? Number(match[1]) / 100 : 0.12;
  const cdiAssumption = 0.105;
  if (/cdi/i.test(rate) && /[+]/.test(rate)) return cdiAssumption + value;
  if (/cdi/i.test(rate)) return cdiAssumption;
  return Number.isFinite(value) && value > 0 ? value : 0.12;
}

export default function Home() {
  const [auth, setAuth] = useState(false);
  const [currentUser, setCurrentUser] = useState<AppUser>(usersSeed[0]);
  const [view, setView] = useState<View>("dashboard");
  const [modal, setModal] = useState<Modal>(null);
  const [detail, setDetail] = useState<null | { title: string; rows: [string, string][] }>(null);
  const [editingAssignor, setEditingAssignor] = useState<Assignor | null>(null);
  const [portalAssignor, setPortalAssignor] = useState<Assignor | null>(null);
  const [editingDebtor, setEditingDebtor] = useState<Debtor | null>(null);
  const [confirmingReceivable, setConfirmingReceivable] = useState<Receivable | null>(null);
  const [committeeReceivable, setCommitteeReceivable] = useState<Receivable | null>(null);
  const [settlingReceivable, setSettlingReceivable] = useState<Receivable | null>(null);
  const [assignors, setAssignors] = useState(assignorsSeed);
  const [debtors, setDebtors] = useState(debtorsSeed);
  const [receivables, setReceivables] = useState(receivablesSeed);
  const [batches, setBatches] = useState(batchesSeed);
  const [groups, setGroups] = useState(groupsSeed);
  const [users, setUsers] = useState(usersSeed);
  const [audits, setAudits] = useState(auditsSeed);
  const [documents, setDocuments] = useState(documentsSeed);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>(cashAccountsSeed);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>(cashSeed);
  const [bankStatementEntries, setBankStatementEntries] = useState<BankStatementEntry[]>(bankStatementSeed);
  const [fundingIssues, setFundingIssues] = useState<FundingIssue[]>(fundingSeed);
  const [cessionOperations, setCessionOperations] = useState<CessionOperation[]>([]);
  const [documentChecklists, setDocumentChecklists] = useState<DocumentChecklist[]>([]);
  const [confirmationLinks, setConfirmationLinks] = useState<Record<string, ConfirmationLinkState>>({});
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [annualRate, setAnnualRate] = useState(DEFAULT_ACQUISITION_ANNUAL_RATE * 100);
  const [serviceFeeBps, setServiceFeeBps] = useState(DEFAULT_SERVICE_FEE_BPS);

  async function refreshOperationalData() {
    try {
      const [assignorsRes, debtorsRes, batchesRes, receivablesRes, documentsRes, checklistRes, cashAccountsRes, cashMovementsRes, bankStatementRes, fundingRes, auditsRes, usersRes, groupsRes, confirmationLinksRes, cessionOpsRes] = await Promise.all([
        fetch("/api/assignors"),
        fetch("/api/debtors"),
        fetch("/api/import-batches"),
        fetch("/api/receivables"),
        fetch("/api/documents"),
        fetch("/api/document-checklists"),
        fetch("/api/cash-accounts"),
        fetch("/api/cash-movements"),
        fetch("/api/bank-statement-entries"),
        fetch("/api/funding-issues"),
        fetch("/api/audits"),
        fetch("/api/users"),
        fetch("/api/permission-groups"),
        fetch("/api/confirmation-links"),
        fetch("/api/cession-operations"),
      ]);
      if (assignorsRes.ok) setAssignors(await assignorsRes.json());
      if (debtorsRes.ok) setDebtors(await debtorsRes.json());
      if (batchesRes.ok) setBatches(await batchesRes.json());
      if (receivablesRes.ok) setReceivables(await receivablesRes.json());
      if (documentsRes.ok) setDocuments(await documentsRes.json());
      if (checklistRes.ok) setDocumentChecklists(await checklistRes.json());
      if (cashAccountsRes.ok) setCashAccounts(await cashAccountsRes.json());
      if (cashMovementsRes.ok) setCashMovements(await cashMovementsRes.json());
      if (bankStatementRes.ok) setBankStatementEntries(await bankStatementRes.json());
      if (fundingRes.ok) setFundingIssues(await fundingRes.json());
      if (auditsRes.ok) setAudits(await auditsRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
      if (groupsRes.ok) setGroups(await groupsRes.json());
      if (confirmationLinksRes.ok) {
        const links = (await confirmationLinksRes.json()) as Array<ConfirmationLinkState & { receivableId: string }>;
        setConfirmationLinks(Object.fromEntries(links.map((item) => [item.receivableId, item])));
      }
      if (cessionOpsRes.ok) setCessionOperations(await cessionOpsRes.json());
    } catch {
      setNotice("Operando com dados demonstrativos locais. Banco indisponível no momento.");
    }
  }

  const activeReceivables = receivables.filter((item) => !item.deletedAt);
  const portfolioReceivables = activeReceivables.filter((item) => item.portfolioStatus || ["Comprado", "Vencido", "Liquidado"].includes(item.status));
  const owned = portfolioReceivables.filter((item) => item.status !== "Liquidado" && (item.outstandingValue ?? item.valor) > 0);
  const can = (module: string, action: PermissionAction) => hasPermission(currentUser, groups, module, action);
  const audit = (action: string, entity: string, before?: unknown, after?: unknown) =>
    setAudits((items) => createAudit(items, action, entity, currentUser.name, before, after));
  const requirePermission = (module: string, action: PermissionAction, entity: string) => {
    if (can(module, action)) return true;
    audit("PERMISSION_DENIED", `${module}:${action}:${entity}`);
    return false;
  };

  const navGroups = [
    {
      label: "Principal",
      items: [
        ["Dashboard", "dashboard", LayoutDashboard],
        ["Alertas", "alertas", AlertTriangle],
        ["Esteira", "esteira", ListChecks],
      ],
    },
    {
      label: "Cadastros",
      items: [
        ["Cedentes", "cedentes", Building2],
        ["Sacados", "sacados", Users],
        ["Documentos", "documentos", FileText],
      ],
    },
    {
      label: "Operação",
      items: [
        ["Jornada de cessão", "jornada", ListChecks],
        ["Importação", "importacao", FileUp],
        ["Confirmação", "confirmacao", ClipboardCheck],
        ["Elegibilidade", "elegibilidade", ShieldCheck],
        ["Compra", "compra", ShoppingCart],
        ["Carteira", "carteira", BriefcaseBusiness],
        ["Cobrança", "cobranca", Banknote],
      ],
    },
    {
      label: "Gestão",
      items: [
        ["Risco", "risco", TrendingUp],
        ["Comitê", "comite", Gavel],
        ["Caixa", "caixa", Landmark],
        ["Funding", "funding", ReceiptText],
        ["Relatórios", "relatorios", BarChart3],
      ],
    },
    {
      label: "Administração",
      items: [["Usuários e permissões", "usuarios", KeyRound]],
    },
  ] as const;
  const isNavVisible = (value: View) => can(viewModule[value], "view") || (value === "usuarios" && can("Usuários", "admin"));
  const visibleNavGroups = navGroups
    .map((group) => ({ ...group, items: group.items.filter(([, value]) => isNavVisible(value)) }))
    .filter((group) => group.items.length > 0);
  const [eye, title, desc] = info[view];

  const dashboard = useMemo(() => {
    const carteira = owned.reduce((sum, item) => sum + item.valor, 0);
    const elegiveis = activeReceivables.filter((item) => item.status === "Elegível").length;
    return {
      carteira,
      ativos: owned.length,
      elegiveis,
      total: activeReceivables.reduce((sum, item) => sum + item.valor, 0),
    };
  }, [activeReceivables, owned]);

  async function persistJson<T>(url: string, init: RequestInit): Promise<T> {
    try {
      const response = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Não foi possível concluir a operação.");
      return payload as T;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível concluir a operação.");
      throw error;
    }
  }

  async function refreshAudits() {
    const response = await fetch("/api/audits");
    if (response.ok) setAudits(await response.json());
  }

  function buildAssignorInput(f: FormData, status: Assignor["status"] = "Ativo") {
    const procurador = {
      nome: String(f.get("procuradorNome") ?? "").trim(),
      cpf: String(f.get("procuradorCpf") ?? "").trim(),
      cargo: String(f.get("procuradorCargo") ?? "").trim(),
      email: String(f.get("procuradorEmail") ?? "").trim(),
      telefone: String(f.get("procuradorTelefone") ?? "").trim(),
      poderes: String(f.get("procuradorPoderes") ?? "").trim(),
      validadeMandato: String(f.get("procuradorValidade") ?? "").trim(),
    };
    const beneficiario = {
      nome: String(f.get("beneficiarioNome") ?? "").trim(),
      cpf: String(f.get("beneficiarioCpf") ?? "").trim(),
      participacao: Number(f.get("beneficiarioParticipacao") ?? 0),
      pep: String(f.get("beneficiarioPep") ?? "Não informado"),
    };
    return {
      nome: String(f.get("nome")),
      nomeFantasia: String(f.get("nomeFantasia") ?? ""),
      doc: String(f.get("doc")),
      inscricaoEstadual: String(f.get("inscricaoEstadual") ?? ""),
      inscricaoMunicipal: String(f.get("inscricaoMunicipal") ?? ""),
      fundacao: String(f.get("fundacao") ?? ""),
      extra: String(f.get("extra")),
      site: String(f.get("site") ?? ""),
      email: String(f.get("email") ?? ""),
      telefone: String(f.get("telefone") ?? ""),
      endereco: String(f.get("endereco") ?? ""),
      cidade: String(f.get("cidade") ?? ""),
      uf: String(f.get("uf") ?? ""),
      grupoEconomico: String(f.get("grupoEconomico") ?? ""),
      receitaAnual: Number(f.get("receitaAnual") ?? 0),
      funcionarios: Number(f.get("funcionarios") ?? 0),
      valor: Number(f.get("valor")),
      gerenteRelacionamento: String(f.get("gerenteRelacionamento") ?? ""),
      etapaOnboarding: String(f.get("etapaOnboarding") ?? "Cadastro inicial"),
      complianceStatus: String(f.get("complianceStatus") ?? "Pendente"),
      kycStatus: String(f.get("kycStatus") ?? "Pendente"),
      consultaSancoes: String(f.get("consultaSancoes") ?? "Não consultado"),
      exposicaoPep: String(f.get("exposicaoPep") ?? "Não informado"),
      parecerCompliance: String(f.get("parecerCompliance") ?? ""),
      ultimaRevisaoCompliance: String(f.get("ultimaRevisaoCompliance") ?? ""),
      procuradores: procurador.nome ? [procurador] : [],
      beneficiariosFinais: beneficiario.nome ? [beneficiario] : [],
      status,
    };
  }

  function buildAssignorEntityInput(entity: Assignor, status: Assignor["status"]) {
    return {
      nome: entity.nome,
      nomeFantasia: entity.nomeFantasia ?? "",
      doc: entity.doc,
      inscricaoEstadual: entity.inscricaoEstadual ?? "",
      inscricaoMunicipal: entity.inscricaoMunicipal ?? "",
      fundacao: entity.fundacao ?? "",
      extra: entity.setor,
      site: entity.site ?? "",
      email: entity.email ?? "",
      telefone: entity.telefone ?? "",
      endereco: entity.endereco ?? "",
      cidade: entity.cidade ?? "",
      uf: entity.uf ?? "",
      grupoEconomico: entity.grupoEconomico ?? "",
      receitaAnual: entity.receitaAnual ?? 0,
      funcionarios: entity.funcionarios ?? 0,
      valor: entity.limite,
      gerenteRelacionamento: entity.gerenteRelacionamento ?? "",
      etapaOnboarding: entity.etapaOnboarding ?? "Cadastro inicial",
      complianceStatus: entity.complianceStatus ?? "Pendente",
      kycStatus: entity.kycStatus ?? "Pendente",
      consultaSancoes: entity.consultaSancoes ?? "Não consultado",
      exposicaoPep: entity.exposicaoPep ?? "Não informado",
      parecerCompliance: entity.parecerCompliance ?? "",
      ultimaRevisaoCompliance: entity.ultimaRevisaoCompliance ?? "",
      procuradores: entity.procuradores ?? [],
      beneficiariosFinais: entity.beneficiariosFinais ?? [],
      status,
    };
  }

  function buildDebtorInput(f: FormData, status: Debtor["status"] = "Ativo") {
    return {
      nome: String(f.get("nome") ?? ""),
      nomeFantasia: String(f.get("nomeFantasia") ?? ""),
      doc: String(f.get("doc") ?? ""),
      extra: String(f.get("extra") ?? ""),
      valor: Number(f.get("valor") ?? 0),
      email: String(f.get("email") ?? ""),
      telefone: String(f.get("telefone") ?? ""),
      site: String(f.get("site") ?? ""),
      endereco: String(f.get("endereco") ?? ""),
      cidade: String(f.get("cidade") ?? ""),
      uf: String(f.get("uf") ?? ""),
      contatoFinanceiroNome: String(f.get("contatoFinanceiroNome") ?? ""),
      contatoFinanceiroCargo: String(f.get("contatoFinanceiroCargo") ?? ""),
      contatoFinanceiroEmail: String(f.get("contatoFinanceiroEmail") ?? ""),
      contatoFinanceiroTelefone: String(f.get("contatoFinanceiroTelefone") ?? ""),
      emailConfirmacao: String(f.get("emailConfirmacao") ?? ""),
      telefoneConfirmacao: String(f.get("telefoneConfirmacao") ?? ""),
      canalConfirmacao: String(f.get("canalConfirmacao") ?? "E-mail"),
      janelaConfirmacao: String(f.get("janelaConfirmacao") ?? ""),
      statusConfirmacao: String(f.get("statusConfirmacao") ?? "Pendente"),
      ultimaConfirmacao: String(f.get("ultimaConfirmacao") ?? ""),
      observacaoConfirmacao: String(f.get("observacaoConfirmacao") ?? ""),
      evidenciaRelacionamento: String(f.get("evidenciaRelacionamento") ?? ""),
      historicoProtestos: String(f.get("historicoProtestos") ?? ""),
      comportamentoPagamento: String(f.get("comportamentoPagamento") ?? ""),
      observacoesOperacionais: String(f.get("observacoesOperacionais") ?? ""),
      status,
    };
  }

  function buildDebtorEntityInput(entity: Debtor, status: Debtor["status"]) {
    return {
      nome: entity.nome,
      nomeFantasia: entity.nomeFantasia ?? "",
      doc: entity.doc,
      extra: entity.rating,
      valor: entity.valor,
      email: entity.email ?? "",
      telefone: entity.telefone ?? "",
      site: entity.site ?? "",
      endereco: entity.endereco ?? "",
      cidade: entity.cidade ?? "",
      uf: entity.uf ?? "",
      contatoFinanceiroNome: entity.contatoFinanceiroNome ?? "",
      contatoFinanceiroCargo: entity.contatoFinanceiroCargo ?? "",
      contatoFinanceiroEmail: entity.contatoFinanceiroEmail ?? "",
      contatoFinanceiroTelefone: entity.contatoFinanceiroTelefone ?? "",
      emailConfirmacao: entity.emailConfirmacao ?? "",
      telefoneConfirmacao: entity.telefoneConfirmacao ?? "",
      canalConfirmacao: entity.canalConfirmacao ?? "E-mail",
      janelaConfirmacao: entity.janelaConfirmacao ?? "",
      statusConfirmacao: entity.statusConfirmacao ?? "Pendente",
      ultimaConfirmacao: entity.ultimaConfirmacao ?? "",
      observacaoConfirmacao: entity.observacaoConfirmacao ?? "",
      evidenciaRelacionamento: entity.evidenciaRelacionamento ?? "",
      historicoProtestos: entity.historicoProtestos ?? "",
      comportamentoPagamento: entity.comportamentoPagamento ?? "",
      observacoesOperacionais: entity.observacoesOperacionais ?? "",
      status,
    };
  }

  async function addAssignor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!requirePermission("Cedentes", "create", "novo cedente")) return;
    const f = new FormData(e.currentTarget);
    const input = buildAssignorInput(f);
    const entity = await persistJson<Assignor>("/api/assignors", { method: "POST", body: JSON.stringify(input) });
    setAssignors((items) => [...items, entity]);
    audit("ASSIGNOR_CREATED", entity.id, null, entity);
    await refreshAudits();
    setModal(null);
    setNotice("Cedente salvo com sucesso.");
  }

  async function addDebtor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!requirePermission("Sacados", "create", "novo sacado")) return;
    const f = new FormData(e.currentTarget);
    const input = buildDebtorInput(f);
    const entity = await persistJson<Debtor>("/api/debtors", { method: "POST", body: JSON.stringify(input) });
    setDebtors((items) => [...items, entity]);
    audit("DEBTOR_CREATED", entity.id, null, entity);
    await refreshAudits();
    setModal(null);
    setNotice("Sacado salvo com sucesso.");
  }

  async function updateAssignor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editingAssignor || !requirePermission("Cedentes", "create", editingAssignor.id)) return;
    const f = new FormData(e.currentTarget);
    const input = buildAssignorInput(f, String(f.get("status")) as Assignor["status"]);
    const persisted = await persistJson<Assignor>(`/api/assignors/${editingAssignor.id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    const updated = { ...persisted, exposicao: editingAssignor.exposicao };
    setAssignors((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    audit("ASSIGNOR_UPDATED", updated.id, editingAssignor, updated);
    await refreshAudits();
    setEditingAssignor(null);
    setModal(null);
    setNotice("Cedente atualizado com sucesso.");
  }

  async function inviteAssignorPortalUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!portalAssignor || !requirePermission("Cedentes", "create", portalAssignor.id)) return;
    const f = new FormData(e.currentTarget);
    const input = {
      assignorId: portalAssignor.id,
      name: String(f.get("nome") ?? ""),
      email: String(f.get("email") ?? ""),
      role: String(f.get("role") ?? "Representante legal"),
      password: String(f.get("password") ?? ""),
      status: String(f.get("status") ?? "Ativo"),
    };
    const updated = await persistJson<Assignor>("/api/assignor-portal-users", {
      method: "POST",
      body: JSON.stringify(input),
    });
    const next = { ...portalAssignor, ...updated };
    setAssignors((items) => items.map((item) => (item.id === portalAssignor.id ? next : item)));
    audit("ASSIGNOR_PORTAL_USER_INVITED", portalAssignor.id, portalAssignor, next);
    await refreshAudits();
    setPortalAssignor(null);
    setModal(null);
    setNotice("Usuário do portal do cedente criado como convite pendente.");
  }

  async function updateDebtor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editingDebtor || !requirePermission("Sacados", "create", editingDebtor.id)) return;
    const f = new FormData(e.currentTarget);
    const input = buildDebtorInput(f, String(f.get("status")) as Debtor["status"]);
    const updated = await persistJson<Debtor>(`/api/debtors/${editingDebtor.id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    setDebtors((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    audit("DEBTOR_UPDATED", updated.id, editingDebtor, updated);
    await refreshAudits();
    setEditingDebtor(null);
    setModal(null);
    setNotice("Sacado atualizado com sucesso.");
  }

  async function changeAssignorStatus(entity: Assignor) {
    if (!requirePermission("Cedentes", "create", entity.id)) return;
    const nextStatus = entity.status === "Bloqueado" ? "Ativo" : "Bloqueado";
    const persisted = await persistJson<Assignor>(`/api/assignors/${entity.id}`, {
      method: "PATCH",
      body: JSON.stringify(buildAssignorEntityInput(entity, nextStatus)),
    });
    const updated = { ...persisted, exposicao: entity.exposicao };
    setAssignors((items) => items.map((item) => (item.id === entity.id ? updated : item)));
    audit(nextStatus === "Bloqueado" ? "ASSIGNOR_BLOCKED" : "ASSIGNOR_REACTIVATED", entity.id, entity, updated);
    await refreshAudits();
    setNotice(nextStatus === "Bloqueado" ? "Cedente bloqueado." : "Cedente reativado.");
  }

  async function changeDebtorStatus(entity: Debtor) {
    if (!requirePermission("Sacados", "create", entity.id)) return;
    const nextStatus = entity.status === "Bloqueado" ? "Ativo" : "Bloqueado";
    const updated = await persistJson<Debtor>(`/api/debtors/${entity.id}`, {
      method: "PATCH",
      body: JSON.stringify(buildDebtorEntityInput(entity, nextStatus)),
    });
    setDebtors((items) => items.map((item) => (item.id === entity.id ? updated : item)));
    audit(nextStatus === "Bloqueado" ? "DEBTOR_BLOCKED" : "DEBTOR_REACTIVATED", entity.id, entity, updated);
    await refreshAudits();
    setNotice(nextStatus === "Bloqueado" ? "Sacado bloqueado." : "Sacado reativado.");
  }

  async function archiveAssignor(entity: Assignor) {
    if (!requirePermission("Cedentes", "create", entity.id)) return;
    const persisted = await persistJson<Partial<Assignor>>(`/api/assignors/${entity.id}`, { method: "DELETE" });
    const updated = persisted.nome ? (persisted as Assignor) : { ...entity, deletedAt: now(), status: "Inativo" as Assignor["status"] };
    setAssignors((items) => items.map((item) => (item.id === entity.id ? updated : item)));
    audit("ASSIGNOR_SOFT_DELETED", entity.id, entity, updated);
    await refreshAudits();
    setNotice("Cedente arquivado com soft delete.");
  }

  async function archiveDebtor(entity: Debtor) {
    if (!requirePermission("Sacados", "create", entity.id)) return;
    const persisted = await persistJson<Partial<Debtor>>(`/api/debtors/${entity.id}`, { method: "DELETE" });
    const updated = persisted.nome ? (persisted as Debtor) : { ...entity, deletedAt: now(), status: "Inativo" as Debtor["status"] };
    setDebtors((items) => items.map((item) => (item.id === entity.id ? updated : item)));
    audit("DEBTOR_SOFT_DELETED", entity.id, entity, updated);
    await refreshAudits();
    setNotice("Sacado arquivado com soft delete.");
  }

  async function addUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!requirePermission("Usuários", "admin", "novo usuário")) return;
    const f = new FormData(e.currentTarget);
    const groupId = String(f.get("group"));
    const input = {
      name: String(f.get("nome")),
      email: String(f.get("email")),
      groupId,
      status: String(f.get("status")) as AppUser["status"],
      password: String(f.get("password")),
    };
    const user = await persistJson<AppUser & { inviteEmail?: { status: "skipped" | "sent" | "failed"; reason?: string } }>("/api/users", { method: "POST", body: JSON.stringify(input) });
    setUsers((items) => [...items, user]);
    setGroups((items) => items.map((group) => (group.id === groupId ? { ...group, users: group.users + 1 } : group)));
    audit("USER_CREATED", user.id, null, user);
    await refreshAudits();
    setModal(null);
    setNotice(user.inviteEmail?.status === "sent" ? "Usuário criado e convite enviado por e-mail." : user.inviteEmail ? `Usuário criado, mas o e-mail não foi enviado: ${user.inviteEmail.reason ?? "verifique a configuração de e-mail"}.` : "Usuário criado com senha provisória.");
  }

  async function resendUserInvite(user: AppUser) {
    if (!requirePermission("Usuários", "admin", user.id)) return;
    const result = await persistJson<{ email: { status: "skipped" | "sent" | "failed"; reason?: string }; link: string }>(`/api/users/${user.id}/invite`, { method: "POST" });
    await refreshAudits();
    setNotice(result.email.status === "sent" ? `Convite reenviado para ${user.email}.` : `Convite gerado, mas o e-mail não foi enviado: ${result.email.reason ?? "verifique a configuração de e-mail"}.`);
  }

  async function createCessionOperation(input: {
    title: string;
    status: string;
    currentStep: string;
    faceValue: number;
    purchaseValue: number;
    readyCount: number;
    blockedCount: number;
    snapshot: unknown;
  }) {
    if (!requirePermission("Compra", "create", "cession-operation")) return;
    const operation = await persistJson<CessionOperation>("/api/cession-operations", {
      method: "POST",
      body: JSON.stringify(input),
    });
    setCessionOperations((items) => [operation, ...items]);
    await refreshAudits();
    setNotice(`Operação ${operation.id} criada e registrada na jornada.`);
  }

  async function updateCessionOperation(operation: CessionOperation, status: string, currentStep: string) {
    if (!requirePermission("Compra", "create", operation.id)) return;
    const updated = await persistJson<CessionOperation>("/api/cession-operations", {
      method: "PATCH",
      body: JSON.stringify({ id: operation.id, status, currentStep, notes: `Atualização operacional para ${currentStep}.` }),
    });
    setCessionOperations((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    await refreshAudits();
    setNotice(`Operação ${updated.id} atualizada para ${updated.currentStep}.`);
  }

  async function addDocument(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!requirePermission("Documentos", "create", "novo documento")) return;
    const f = new FormData(e.currentTarget);
    const input = {
      name: String(f.get("nome")),
      type: String(f.get("tipo")),
      entity: String(f.get("entity")),
      status: "Em revisão",
      stage: String(f.get("stage") ?? ""),
      requirement: String(f.get("requirement") ?? ""),
      expiresAt: String(f.get("expiresAt") ?? ""),
      sizeBytes: Number(f.get("sizeBytes") ?? 0),
    };
    try {
      const doc = await persistJson<DocumentRecord>("/api/documents", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setDocuments((items) => [doc, ...items]);
      await refreshAudits();
      await refreshOperationalData();
      setNotice("Documento registrado e vinculado com sucesso.");
      setModal(null);
    } catch {
      const doc: DocumentRecord = {
        id: `DOC-${String(documents.length + 1).padStart(3, "0")}`,
        name: input.name,
        type: input.type as DocumentRecord["type"],
        entity: input.entity,
        status: "Em revisão",
        stage: input.stage,
        requirement: input.requirement,
        expiresAt: input.expiresAt,
        uploadedAt: now(),
        size: "Metadado",
      };
      setDocuments((items) => [doc, ...items]);
      audit("DOCUMENT_UPLOADED", doc.id, null, doc);
      setModal(null);
    }
  }

  function softDeleteReceivable(id: string) {
    if (!requirePermission("Carteira", "admin", id)) return;
    const before = receivables.find((item) => item.id === id);
    setReceivables((items) => items.map((item) => (item.id === id ? { ...item, deletedAt: now() } : item)));
    audit("RECEIVABLE_SOFT_DELETED", id, before, { deletedAt: now() });
  }

  async function runRules() {
    if (!requirePermission("Elegibilidade", "approve", "motor")) return;
    try {
      const response = await persistJson<{ receivables: Receivable[]; updated: number }>("/api/eligibility/run", {
        method: "POST",
      });
      setReceivables(response.receivables);
      await refreshAudits();
      setNotice(`${response.updated} ativos reprocessados pelo motor de elegibilidade.`);
    } catch {
      setReceivables((items) => runEligibility(items, assignors, debtors));
      audit("ELIGIBILITY_ENGINE_RUN", `${activeReceivables.length} ativos`);
    }
  }

  async function updateReceivableConfirmation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirmingReceivable || !requirePermission("Confirmação", "create", confirmingReceivable.id)) return;
    const f = new FormData(e.currentTarget);
    const input = {
      confirmationStatus: String(f.get("confirmationStatus") ?? "Pendente"),
      confirmationChannel: String(f.get("confirmationChannel") ?? "E-mail"),
      confirmationEvidence: String(f.get("confirmationEvidence") ?? ""),
      confirmationNotes: String(f.get("confirmationNotes") ?? ""),
    };
    const updated = await persistJson<Receivable>(`/api/receivables/${confirmingReceivable.id}/confirmation`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    setReceivables((items) => items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
    audit("RECEIVABLE_CONFIRMATION_UPDATED", updated.id, confirmingReceivable, updated);
    await refreshAudits();
    setConfirmingReceivable(null);
    setModal(null);
    setNotice("Confirmação da duplicata registrada. Reprocesse a elegibilidade para refletir a política v1.4.");
  }

  async function decideCommittee(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!committeeReceivable || !requirePermission("Comitê", "approve", committeeReceivable.id)) return;
    const f = new FormData(e.currentTarget);
    const input = {
      decision: String(f.get("decision") ?? ""),
      justification: String(f.get("justification") ?? ""),
    };
    const updated = await persistJson<Receivable>(`/api/receivables/${committeeReceivable.id}/committee`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    setReceivables((items) => items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
    audit("COMMITTEE_DECISION", updated.id, committeeReceivable, { ...updated, decision: input.decision });
    await refreshAudits();
    setCommitteeReceivable(null);
    setModal(null);
    setNotice(updated.status === "Aprovado" ? "Exceção aprovada. Ativo liberado para compra." : "Decisão do comitê registrada.");
  }

  async function purchase(id: string) {
    if (!requirePermission("Compra", "purchase", id)) return;
    const before = receivables.find((item) => item.id === id);
    const pricing = before ? priceReceivable(before, annualRate / 100, serviceFeeBps) : null;
    if (!before || !pricing) {
      setNotice("Ativo não encontrado para compra.");
      return;
    }
    const readiness = buildPurchaseReadiness(before, pricing, assignors, debtors, documentChecklists, cashAccounts);
    if (readiness.blockers.length) {
      const summary = readiness.blockers.slice(0, 3).map((check) => check.label).join(", ");
      audit("PURCHASE_BLOCKED_PRECHECK", id, before, { blockers: readiness.blockers });
      setNotice(`Compra bloqueada por pendências: ${summary}.`);
      return;
    }
    try {
      const updated = await persistJson<Receivable>("/api/purchases", {
        method: "POST",
        body: JSON.stringify({ receivableId: id, annualRate: annualRate / 100, serviceFeeBps }),
      });
      setReceivables((items) => items.map((item) => (item.id === id ? { ...updated, pricing: pricing ?? undefined } : item)));
      await refreshAudits();
      setNotice("Ativo comprado e registrado na carteira warehouse.");
    } catch {
      audit("PURCHASE_FAILED", id, before, { pricing });
    }
  }

  async function settleReceivable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!settlingReceivable || !requirePermission("Cobrança", "create", settlingReceivable.id)) return;
    const f = new FormData(e.currentTarget);
    const input = {
      receivableId: settlingReceivable.id,
      action: String(f.get("action") ?? "settle"),
      amount: Number(f.get("amount") ?? 0),
      date: String(f.get("date") ?? ""),
      method: String(f.get("method") ?? ""),
      notes: [
        String(f.get("notes") ?? "").trim(),
        `Canal: ${String(f.get("channel") ?? "Não informado")}`,
        `Contato: ${String(f.get("contact") ?? "Não informado")}`,
        `Próxima ação: ${String(f.get("nextAction") ?? "Não informado")}`,
        `Responsável: ${String(f.get("owner") ?? "Operações HOAM")}`,
        `Evidência: ${String(f.get("evidence") ?? "Não informada")}`,
      ].filter(Boolean).join(" | "),
    };
    try {
      const result = await persistJson<{ receivable: Receivable }>("/api/settlements", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setReceivables((items) => items.map((item) => (item.id === result.receivable.id ? { ...item, ...result.receivable } : item)));
      await refreshAudits();
      setNotice(input.action === "settle" ? "Recebimento registrado e carteira atualizada." : "Evento de cobrança registrado.");
    } catch {
      if (input.action === "settle") {
        const before = settlingReceivable;
        const outstanding = before.outstandingValue ?? before.valor;
        const nextOutstanding = Math.max(0, outstanding - input.amount);
        setReceivables((items) =>
          items.map((item) =>
            item.id === before.id
              ? { ...item, status: nextOutstanding <= 0 ? "Liquidado" : "Comprado", outstandingValue: nextOutstanding, portfolioStatus: nextOutstanding <= 0 ? "Liquidado" : "Liquidação parcial" }
              : item,
          ),
        );
        audit("RECEIVABLE_SETTLEMENT_LOCAL", before.id, before, { amount: input.amount, nextOutstanding });
      }
    }
    setSettlingReceivable(null);
    setModal(null);
  }

  async function addCashAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!requirePermission("Caixa", "create", "cash-account")) return;
    const f = new FormData(e.currentTarget);
    const input = {
      name: String(f.get("name") ?? ""),
      bankName: String(f.get("bankName") ?? ""),
      branch: String(f.get("branch") ?? ""),
      accountNumber: String(f.get("accountNumber") ?? ""),
      accountType: String(f.get("accountType") ?? "Conta movimento"),
      purpose: String(f.get("purpose") ?? "OPERATING"),
      openingBalance: Number(f.get("openingBalance") ?? 0),
      status: String(f.get("status") ?? "Ativa"),
    };
    try {
      const account = await persistJson<CashAccount>("/api/cash-accounts", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setCashAccounts((items) => [account, ...items]);
      await refreshAudits();
      setNotice("Conta operacional cadastrada.");
    } catch {
      const account: CashAccount = { id: `CTA-WH-${String(cashAccounts.length + 1).padStart(3, "0")}`, currency: "BRL", balance: input.openingBalance, deletedAt: null, ...input };
      setCashAccounts((items) => [account, ...items]);
      audit("CASH_ACCOUNT_CREATED_LOCAL", account.id, null, account);
    }
    setModal(null);
  }

  async function addCashMovement(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!requirePermission("Caixa", "create", "cash-movement")) return;
    const f = new FormData(e.currentTarget);
    const input = {
      accountId: String(f.get("accountId") ?? ""),
      type: String(f.get("type") ?? "INFLOW"),
      amount: Number(f.get("amount") ?? 0),
      date: String(f.get("date") ?? ""),
      description: String(f.get("description") ?? ""),
      reference: String(f.get("reference") ?? ""),
    };
    try {
      const movement = await persistJson<CashMovement>("/api/cash-movements", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setCashMovements((items) => [movement, ...items]);
      await refreshOperationalData();
      setNotice("Movimento de caixa lançado.");
    } catch {
      const account = cashAccounts.find((item) => item.id === input.accountId);
      const movement: CashMovement = {
        id: `CX-${String(cashMovements.length + 1).padStart(4, "0")}`,
        accountId: input.accountId,
        accountName: account?.name ?? null,
        date: input.date,
        description: input.description,
        type: input.type === "OUTFLOW" ? "Saída" : "Entrada",
        amount: input.amount,
        reference: input.reference,
      };
      setCashMovements((items) => [movement, ...items]);
      audit("CASH_MOVEMENT_CREATED_LOCAL", movement.id, null, movement);
    }
    setModal(null);
  }

  async function addBankStatementEntry(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!requirePermission("Caixa", "create", "bank-statement")) return;
    const f = new FormData(e.currentTarget);
    const input = {
      accountId: String(f.get("accountId") ?? ""),
      type: String(f.get("type") ?? "INFLOW"),
      amount: Number(f.get("amount") ?? 0),
      date: String(f.get("date") ?? ""),
      description: String(f.get("description") ?? ""),
      reference: String(f.get("reference") ?? ""),
      notes: String(f.get("notes") ?? ""),
    };
    try {
      const entry = await persistJson<BankStatementEntry>("/api/bank-statement-entries", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setBankStatementEntries((items) => [entry, ...items]);
      await refreshAudits();
      setNotice("Item de extrato registrado para conciliação.");
    } catch {
      const account = cashAccounts.find((item) => item.id === input.accountId);
      const entry: BankStatementEntry = {
        id: `EXT-${String(bankStatementEntries.length + 1).padStart(4, "0")}`,
        accountId: input.accountId,
        accountName: account?.name ?? null,
        date: input.date,
        description: input.description,
        type: input.type === "OUTFLOW" ? "Saída" : "Entrada",
        amount: input.amount,
        reference: input.reference,
        status: "Pendente",
        notes: input.notes,
      };
      setBankStatementEntries((items) => [entry, ...items]);
      audit("BANK_STATEMENT_ENTRY_CREATED_LOCAL", entry.id, null, entry);
    }
    setModal(null);
  }

  async function reconcileBankStatement(entryId: string, action = "auto_match", cashMovementId?: string) {
    if (!requirePermission("Caixa", "create", entryId)) return;
    const before = bankStatementEntries.find((item) => item.id === entryId);
    try {
      const updated = await persistJson<BankStatementEntry>("/api/bank-statement-entries", {
        method: "PATCH",
        body: JSON.stringify({ entryId, action, cashMovementId }),
      });
      setBankStatementEntries((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      await refreshAudits();
      setNotice(updated.status === "Conciliado" ? "Extrato conciliado com o caixa." : "Extrato marcado como divergente.");
    } catch {
      setBankStatementEntries((items) => items.map((item) => (item.id === entryId ? { ...item, status: "Divergente", notes: "Sem movimento equivalente." } : item)));
      audit("BANK_STATEMENT_RECONCILIATION_LOCAL", entryId, before, { status: "Divergente" });
    }
  }

  async function addFundingIssue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!requirePermission("Funding", "create", "funding")) return;
    const f = new FormData(e.currentTarget);
    const input = {
      instrument: String(f.get("instrument") ?? ""),
      amount: Number(f.get("amount") ?? 0),
      rate: String(f.get("rate") ?? ""),
      maturity: String(f.get("maturity") ?? ""),
      status: String(f.get("status") ?? "Estruturando"),
    };
    try {
      const issue = await persistJson<FundingIssue>("/api/funding-issues", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setFundingIssues((items) => [issue, ...items]);
      await refreshAudits();
      setNotice("Linha de funding cadastrada.");
    } catch {
      const issue: FundingIssue = { id: `EMI-${String(fundingIssues.length + 1).padStart(3, "0")}`, ...input, status: input.status as FundingIssue["status"] };
      setFundingIssues((items) => [issue, ...items]);
      audit("FUNDING_ISSUE_CREATED_LOCAL", issue.id, null, issue);
    }
    setModal(null);
  }

  async function updateFundingStatus(id: string, status: FundingIssue["status"]) {
    if (!requirePermission("Funding", "create", id)) return;
    const before = fundingIssues.find((item) => item.id === id);
    try {
      const issue = await persistJson<FundingIssue>("/api/funding-issues", {
        method: "PATCH",
        body: JSON.stringify({ id, status }),
      });
      setFundingIssues((items) => items.map((item) => (item.id === id ? issue : item)));
      await refreshAudits();
    } catch {
      setFundingIssues((items) => items.map((item) => (item.id === id ? { ...item, status } : item)));
      audit("FUNDING_STATUS_UPDATED_LOCAL", id, before, { status });
    }
  }

  async function importFile(file?: File | null) {
    if (!requirePermission("Importação", "create", file?.name ?? "arquivo")) return;
    const content = file && file.name.endsWith(".csv") ? await file.text() : buildDemoCsv();
    try {
      const result = await persistJson<{ batch: ImportBatch; receivables: Receivable[]; errors: string[] }>("/api/import-batches", {
        method: "POST",
        body: JSON.stringify({ fileName: file?.name ?? "modelo_demo.csv", content }),
      });
      setBatches((items) => [result.batch, ...items]);
      setReceivables((items) => [...result.receivables, ...items]);
      await refreshAudits();
      if (result.errors.length) setNotice(`Lote importado com ${result.errors.length} inconsistências.`);
      else setNotice("Lote importado e persistido com sucesso.");
    } catch {
      const batchId = `LOT-${String(batches.length + 1).padStart(3, "0")}`;
      const parsed = parseCsvReceivables(content, batchId);
      const batch: ImportBatch = {
        id: batchId,
        fileName: file?.name ?? "modelo_demo.csv",
        status: parsed.errors.length ? "Com erros" : "Validado",
        totalRows: parsed.receivables.length + parsed.errors.length,
        validRows: parsed.receivables.length,
        invalidRows: parsed.errors.length,
        createdAt: now(),
      };
      setBatches((items) => [batch, ...items]);
      setReceivables((items) => [...items, ...parsed.receivables]);
      audit("RECEIVABLE_BATCH_IMPORTED", batch.id, null, { batch, errors: parsed.errors });
    }
    setModal(null);
    setView("elegibilidade");
  }

  async function generateConfirmationLink(item: Receivable) {
    if (!requirePermission("Confirmação", "create", item.id)) return;
    const result = await persistJson<{
      link: string;
      expiresAt: string;
      recipientEmail: string | null;
      email: null | { status: "skipped" | "sent" | "failed"; reason?: string; providerId?: string | null };
    }>("/api/confirmation-links", {
      method: "POST",
      body: JSON.stringify({ receivableId: item.id, expiresInDays: 7, sendEmail: false, reuseActive: true }),
    });
    setConfirmationLinks((links) => ({
      ...links,
      [item.id]: {
        link: result.link,
        expiresAt: result.expiresAt,
        recipientEmail: result.recipientEmail,
        emailStatus: result.email?.status ?? links[item.id]?.emailStatus ?? null,
        emailError: result.email?.reason ?? null,
        emailSentAt: result.email?.status === "sent" ? new Date().toISOString() : (links[item.id]?.emailSentAt ?? null),
        emailLastAttemptAt: links[item.id]?.emailLastAttemptAt ?? null,
        emailAttempts: links[item.id]?.emailAttempts ?? 0,
      },
    }));
    const expires = new Date(result.expiresAt).toLocaleDateString("pt-BR");
    setNotice(`Link seguro gerado para ${item.id}. Copie e envie manualmente ao sacado. Válido até ${expires}.`);
    await refreshAudits();
  }

  async function togglePermission(groupId: string, module: string, action: PermissionAction) {
    if (!requirePermission("Usuários", "admin", `${groupId}:${module}:${action}`)) return;
    const persisted = await persistJson<AccessGroup>("/api/permission-groups", {
      method: "PATCH",
      body: JSON.stringify({ groupId, module, action }),
    });
    setGroups((current) =>
      current.map((group) => {
        if (group.id === persisted.id) return persisted;
        if (group.id !== groupId || group.id === "admin") return group;
        const existing = group.permissions[module] ?? [];
        const next = existing.includes(action) ? existing.filter((item) => item !== action) : [...existing, action];
        return { ...group, permissions: { ...group.permissions, [module]: next } };
      }),
    );
    audit("PERMISSION_UPDATED", `${groupId}:${module}:${action}`);
    await refreshAudits();
  }

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(f.get("email")),
          password: String(f.get("senha")),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Não foi possível autenticar.");
      if (payload?.user) {
        const user = payload.user as AppUser;
        setCurrentUser(user);
        setUsers((items) => (items.some((item) => item.id === user.id) ? items : [user, ...items]));
      }
      audit("LOGIN_SUCCESS", "Sessão");
      await refreshAudits();
      setAuth(true);
      await refreshOperationalData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível autenticar.");
    }
  }

  if (!auth) {
    return (
      <div className="login">
        <section className="hero">
          <Logo />
          <div>
            <div className="eye">INTELIGÊNCIA PARA O CRÉDITO</div>
            <h1>
              Capital que move.
              <br />
              <em>Gestão que protege.</em>
            </h1>
            <p>Uma plataforma institucional para originação, aquisição e gestão de direitos creditórios com governança em cada etapa.</p>
          </div>
          <small className="muted">© 2026 HOAM Capital · Ambiente seguro</small>
        </section>
        <section className="loginform">
          <form onSubmit={login}>
            <div className="mark">H</div>
            <h2>Acesse sua conta</h2>
            <p className="muted">Entre com suas credenciais corporativas.</p>
            {notice && <div className="notice login-notice"><span>{notice}</span></div>}
            <Field label="E-mail corporativo" name="email" type="email" />
            <Field label="Senha" name="senha" type="password" />
            <button className="btn gold">Entrar no ambiente seguro</button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="side">
        <Logo />
        <nav className="nav">
          {visibleNavGroups.map((group) => (
            <div className="navsection" key={group.label}>
              <div className="navlabel">{group.label}</div>
              {group.items.map(([label, value, Icon]) => (
                <button key={value} className={view === value ? "active" : ""} onClick={() => setView(value)}>
                  <Icon />
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="user">
          <small>Usuário atual</small>
          <select
            value={currentUser.id}
            onChange={(e) => {
              const user = users.find((item) => item.id === e.target.value);
              if (user) {
                setCurrentUser(user);
                setView("dashboard");
              }
            }}
          >
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
          <br />
          <small>{groups.find((group) => group.id === currentUser.groupId)?.name}</small>
        </div>
      </aside>
      <main className="main">
        <header className="top">
          <span>HOAM Warehouse / {title}</span>
          <Bell size={16} />
        </header>
        <div className="content">
          <div className="head">
            <div>
              <div className="eye">{eye}</div>
              <h1>{title}</h1>
              <p>{desc}</p>
            </div>
            <HeaderAction view={view} can={can} setModal={setModal} runRules={runRules} />
          </div>

          <OperationalRail
            assignors={assignors}
            can={can}
            debtors={debtors}
            owned={owned}
            receivables={activeReceivables}
            setView={setView}
            view={view}
          />

          {notice && (
            <div className="notice">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)}>Fechar</button>
            </div>
          )}

          {view === "dashboard" && <Dashboard cashAccounts={cashAccounts} data={dashboard} fundingIssues={fundingIssues} receivables={activeReceivables} owned={owned} />}
          {view === "alertas" && <AlertsPage checklists={documentChecklists} entries={bankStatementEntries} fundingIssues={fundingIssues} receivables={activeReceivables} />}
          {view === "esteira" && <PipelinePage receivables={activeReceivables} />}
          {view === "cedentes" && (
            <EntityPage
              addLabel="Novo cedente"
              canCreate={can("Cedentes", "create")}
              heads={["Código", "Cedente", "Segmento", "Compliance", "Portal", "Limite", "Status", "Ações"]}
              onAdd={() => setModal("cedente")}
              q={q}
              setQ={setQ}
            >
              {assignors
                .filter((item) => !item.deletedAt && item.nome.toLowerCase().includes(q.toLowerCase()))
                .map((item) => (
                  <tr key={item.id}>
                    <td className="mono">{item.id}</td>
                    <td>
                      <button className="linkish" onClick={() => setDetail({ title: item.nome, rows: assignorDetailRows(item) })}>{item.nome}</button>
                      <div className="sub">{item.doc} · {item.cidade || "Cidade não informada"}{item.uf ? `/${item.uf}` : ""}</div>
                    </td>
                    <td>{item.setor}</td>
                    <td><Badge v={item.complianceStatus ?? "Pendente"} /><div className="sub">KYC: {item.kycStatus ?? "Pendente"}</div></td>
                    <td><Badge v={`${item.portalUsers?.length ?? 0} usuário(s)`} /><div className="sub">{(item.portalUsers ?? []).filter((user) => user.status === "Convite pendente").length} convite(s) pendente(s)</div></td>
                    <td className="mono">{fmt(item.limite)}</td>
                    <td><Badge v={item.status} /></td>
                    <td><div className="row-actions"><button className="btn" onClick={() => setDetail({ title: item.nome, rows: assignorDetailRows(item) })}>Detalhe</button><button className="btn" onClick={() => { setPortalAssignor(item); setModal("cedente-portal-user"); }}>Portal</button><button className="btn" onClick={() => { setEditingAssignor(item); setModal("cedente-edit"); }}>Editar</button><button className="btn" onClick={() => changeAssignorStatus(item)}>{item.status === "Bloqueado" ? "Reativar" : "Bloquear"}</button><button className="btn danger-btn" onClick={() => archiveAssignor(item)}>Arquivar</button></div></td>
                  </tr>
                ))}
            </EntityPage>
          )}
          {view === "sacados" && (
            <EntityPage addLabel="Novo sacado" canCreate={can("Sacados", "create")} heads={["Código", "Sacado", "Rating", "Contato confirmação", "Confirmação", "Exposição", "Status", "Ações"]} onAdd={() => setModal("sacado")} q={q} setQ={setQ}>
              {debtors
                .filter((item) => !item.deletedAt && item.nome.toLowerCase().includes(q.toLowerCase()))
                .map((item) => (
                  <tr key={item.id}>
                    <td className="mono">{item.id}</td>
                    <td>
                      <button className="linkish" onClick={() => setDetail({ title: item.nome, rows: debtorDetailRows(item) })}>{item.nome}</button>
                      <div className="sub">{item.doc} · {item.cidade || "Cidade não informada"}{item.uf ? `/${item.uf}` : ""}</div>
                    </td>
                    <td>{item.rating}</td>
                    <td>
                      <div className="entity">{item.contatoFinanceiroNome || "Contato não cadastrado"}</div>
                      <div className="sub">{item.emailConfirmacao || item.contatoFinanceiroEmail || item.telefoneConfirmacao || "Confirmação pendente"}</div>
                    </td>
                    <td><Badge v={item.statusConfirmacao ?? "Pendente"} /><div className="sub">{item.canalConfirmacao ?? "E-mail"} · {item.janelaConfirmacao || "sem janela"}</div></td>
                    <td className="mono">{fmt(item.valor)}</td>
                    <td><Badge v={item.status} /></td>
                    <td>
                      <div className="row-actions">
                        <button className="btn" onClick={() => setDetail({ title: item.nome, rows: debtorDetailRows(item) })}>Detalhe</button>
                        <button className="btn" onClick={() => { setEditingDebtor(item); setModal("sacado-edit"); }}>Editar</button>
                        <button className="btn" onClick={() => changeDebtorStatus(item)}>{item.status === "Bloqueado" ? "Reativar" : "Bloquear"}</button>
                        <button className="btn danger-btn" onClick={() => archiveDebtor(item)}>Arquivar</button>
                      </div>
                    </td>
                  </tr>
              ))}
            </EntityPage>
          )}
          {view === "jornada" && (
            <CessionJourneyPage
              annualRate={annualRate}
              assignors={assignors}
              batches={batches}
              cashAccounts={cashAccounts}
              cessionOperations={cessionOperations}
              createOperation={createCessionOperation}
              debtors={debtors}
              documentChecklists={documentChecklists}
              fundingIssues={fundingIssues}
              owned={owned}
              receivables={activeReceivables}
              serviceFeeBps={serviceFeeBps}
              setModal={setModal}
              setView={setView}
              updateOperation={updateCessionOperation}
            />
          )}
          {view === "importacao" && <ImportPage batches={batches} receivables={activeReceivables} owned={owned} />}
          {view === "confirmacao" && (
            <ConfirmationPage
              links={confirmationLinks}
              receivables={activeReceivables}
              owned={owned}
              onConfirm={(item) => { setConfirmingReceivable(item); setModal("confirmacao"); }}
              onGenerateLink={generateConfirmationLink}
            />
          )}
          {view === "elegibilidade" && <EligibilityPage receivables={activeReceivables} owned={owned} runRules={runRules} />}
          {view === "risco" && <RiskCovenantsPage assignors={assignors} debtors={debtors} fundingIssues={fundingIssues} receivables={activeReceivables} />}
          {view === "comite" && <CommitteePage receivables={activeReceivables} onDecide={(item) => { setCommitteeReceivable(item); setModal("comite"); }} />}
          {view === "compra" && (
            <PurchasePage
              annualRate={annualRate}
              assignors={assignors}
              cashAccounts={cashAccounts}
              debtors={debtors}
              documentChecklists={documentChecklists}
              fundingIssues={fundingIssues}
              onNotice={setNotice}
              receivables={activeReceivables}
              purchase={purchase}
              owned={owned}
              serviceFeeBps={serviceFeeBps}
              setAnnualRate={setAnnualRate}
              setServiceFeeBps={setServiceFeeBps}
            />
          )}
          {view === "carteira" && <PortfolioPage receivables={activeReceivables} owned={portfolioReceivables} softDelete={softDeleteReceivable} canDelete={can("Carteira", "admin")} />}
          {view === "caixa" && (
            <CashPage
              accounts={cashAccounts}
              entries={bankStatementEntries}
              movements={cashMovements}
              onAddAccount={() => setModal("conta-caixa")}
              onAddMovement={() => setModal("movimento-caixa")}
              onAddStatement={() => setModal("extrato-bancario")}
              onReconcile={reconcileBankStatement}
            />
          )}
          {view === "cobranca" && <SettlementPage receivables={portfolioReceivables} onSettle={(item) => { setSettlingReceivable(item); setModal("liquidacao"); }} />}
          {view === "funding" && <FundingPage issues={fundingIssues} portfolioValue={owned.reduce((sum, item) => sum + (item.acquisitionValue ?? item.preco ?? 0), 0)} onAdd={() => setModal("funding")} onStatus={updateFundingStatus} />}
          {view === "documentos" && <DocumentsPage checklists={documentChecklists} documents={documents} canCreate={can("Documentos", "create")} onAdd={() => setModal("documento")} onNotice={setNotice} />}
          {view === "relatorios" && <ReportsPage receivables={activeReceivables} audits={audits} cashMovements={cashMovements} fundingIssues={fundingIssues} />}
          {view === "usuarios" && <AccessControl audits={audits} groups={groups} onResendInvite={resendUserInvite} onToggle={togglePermission} users={users} />}
        </div>
      </main>

      {modal === "cedente" && <AssignorModal title="Novo cedente" onSubmit={addAssignor} close={() => setModal(null)} />}
      {modal === "cedente-edit" && editingAssignor && <AssignorModal title="Editar cedente" initial={editingAssignor} onSubmit={updateAssignor} close={() => { setEditingAssignor(null); setModal(null); }} />}
      {modal === "cedente-portal-user" && portalAssignor && <AssignorPortalUserModal assignor={portalAssignor} close={() => { setPortalAssignor(null); setModal(null); }} save={inviteAssignorPortalUser} />}
      {modal === "sacado" && <DebtorModal title="Novo sacado" onSubmit={addDebtor} close={() => setModal(null)} />}
      {modal === "sacado-edit" && editingDebtor && <DebtorModal title="Editar sacado" initial={editingDebtor} onSubmit={updateDebtor} close={() => { setEditingDebtor(null); setModal(null); }} />}
      {modal === "usuario" && <UserModal close={() => setModal(null)} groups={groups} save={addUser} />}
      {modal === "documento" && <DocumentModal close={() => setModal(null)} save={addDocument} />}
      {modal === "conta-caixa" && <CashAccountModal close={() => setModal(null)} save={addCashAccount} />}
      {modal === "movimento-caixa" && <CashMovementModal accounts={cashAccounts} close={() => setModal(null)} save={addCashMovement} />}
      {modal === "extrato-bancario" && <BankStatementModal accounts={cashAccounts} close={() => setModal(null)} save={addBankStatementEntry} />}
      {modal === "funding" && <FundingModal close={() => setModal(null)} save={addFundingIssue} />}
      {modal === "confirmacao" && confirmingReceivable && <ConfirmationModal close={() => { setConfirmingReceivable(null); setModal(null); }} receivable={confirmingReceivable} save={updateReceivableConfirmation} />}
      {modal === "comite" && committeeReceivable && <CommitteeModal close={() => { setCommitteeReceivable(null); setModal(null); }} receivable={committeeReceivable} save={decideCommittee} />}
      {modal === "liquidacao" && settlingReceivable && <SettlementModal close={() => { setSettlingReceivable(null); setModal(null); }} receivable={settlingReceivable} save={settleReceivable} />}
      {modal === "upload" && <Upload close={() => setModal(null)} done={importFile} />}
      {detail && <DetailModal detail={detail} close={() => setDetail(null)} />}
    </div>
  );
}

function HeaderAction({ view, can, setModal, runRules }: { view: View; can: (m: string, a: PermissionAction) => boolean; setModal: (m: Modal) => void; runRules: () => void }) {
  if (view === "cedentes" && can("Cedentes", "create")) return <button className="btn gold" onClick={() => setModal("cedente")}><Plus size={14} /> Novo cedente</button>;
  if (view === "sacados" && can("Sacados", "create")) return <button className="btn gold" onClick={() => setModal("sacado")}><Plus size={14} /> Novo sacado</button>;
  if (view === "importacao" && can("Importação", "create")) return <button className="btn gold" onClick={() => setModal("upload")}><UploadCloud size={14} /> Importar arquivo</button>;
  if (view === "elegibilidade" && can("Elegibilidade", "approve")) return <button className="btn gold" onClick={runRules}><ShieldCheck size={14} /> Rodar motor</button>;
  if (view === "caixa" && can("Caixa", "create")) return <button className="btn gold" onClick={() => setModal("movimento-caixa")}><Plus size={14} /> Novo movimento</button>;
  if (view === "funding" && can("Funding", "create")) return <button className="btn gold" onClick={() => setModal("funding")}><Plus size={14} /> Nova emissão</button>;
  if (view === "documentos" && can("Documentos", "create")) return <button className="btn gold" onClick={() => setModal("documento")}><Plus size={14} /> Novo documento</button>;
  if (view === "usuarios" && can("Usuários", "admin")) return <button className="btn gold" onClick={() => setModal("usuario")}><Plus size={14} /> Novo usuário</button>;
  return null;
}

function OperationalRail({
  assignors,
  can,
  debtors,
  owned,
  receivables,
  setView,
  view,
}: {
  assignors: Assignor[];
  can: (m: string, a: PermissionAction) => boolean;
  debtors: Debtor[];
  owned: Receivable[];
  receivables: Receivable[];
  setView: (view: View) => void;
  view: View;
}) {
  const steps: { view: View; module: string; label: string; metric: string; ok: boolean }[] = [
    { view: "cedentes", module: "Cedentes", label: "Cedentes", metric: `${assignors.filter((item) => !item.deletedAt).length} cad.`, ok: assignors.some((item) => !item.deletedAt) },
    { view: "sacados", module: "Sacados", label: "Sacados", metric: `${debtors.filter((item) => !item.deletedAt).length} cad.`, ok: debtors.some((item) => !item.deletedAt) },
    { view: "importacao", module: "Importação", label: "Upload", metric: `${receivables.length} ativos`, ok: receivables.length > 0 },
    { view: "elegibilidade", module: "Elegibilidade", label: "Elegibilidade", metric: `${receivables.filter((item) => ["Elegível", "Aprovado"].includes(item.status)).length} prontos`, ok: receivables.some((item) => ["Elegível", "Aprovado"].includes(item.status)) },
    { view: "compra", module: "Compra", label: "Compra", metric: `${receivables.filter((item) => item.status === "Elegível" || item.status === "Aprovado").length} na mesa`, ok: receivables.some((item) => item.status === "Elegível" || item.status === "Aprovado") },
    { view: "carteira", module: "Carteira", label: "Carteira", metric: `${owned.length} ativos`, ok: owned.length > 0 },
  ];
  const visibleSteps = steps.filter((step) => can(step.module, "view"));
  if (!visibleSteps.length) return null;
  return (
    <div className="operation-rail">
      <span>Fluxo MVP</span>
      <div>
        {visibleSteps.map((step, index) => (
          <button className={view === step.view ? "active" : ""} key={step.view} onClick={() => setView(step.view)} type="button">
            <em>{index + 1}</em>
            <b>{step.label}</b>
            <small>{step.metric}</small>
            <i className={step.ok ? "ok" : ""} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Logo() {
  return <div className="logo"><div className="mark">H</div><div>HOAM<small>WAREHOUSE</small></div></div>;
}

function assignorDetailRows(item: Assignor): [string, string][] {
  const procurador = item.procuradores?.[0];
  const beneficiario = item.beneficiariosFinais?.[0];
  const procuradorText = procurador
    ? `${procurador.nome || "Nome não informado"} · ${procurador.cargo || "Cargo não informado"} · ${procurador.poderes || "Poderes não informados"}`
    : "Não cadastrado";
  const beneficiarioText = beneficiario
    ? `${beneficiario.nome || "Nome não informado"} · ${beneficiario.participacao ?? 0}% · PEP: ${beneficiario.pep || "Não informado"}`
    : "Não cadastrado";
  return [
    ["CNPJ", item.doc],
    ["Nome fantasia", item.nomeFantasia || "Não informado"],
    ["Segmento", item.setor],
    ["Grupo econômico", item.grupoEconomico || "Não informado"],
    ["Cidade/UF", `${item.cidade || "Não informada"}${item.uf ? `/${item.uf}` : ""}`],
    ["Endereço", item.endereco || "Não informado"],
    ["E-mail", item.email || "Não informado"],
    ["Telefone", item.telefone || "Não informado"],
    ["Receita anual", item.receitaAnual ? fmt(item.receitaAnual) : "Não informada"],
    ["Funcionários", item.funcionarios ? String(item.funcionarios) : "Não informado"],
    ["Limite", fmt(item.limite)],
    ["Exposição", fmt(item.exposicao)],
    ["Gerente HOAM", item.gerenteRelacionamento || "Não definido"],
    ["Onboarding", item.etapaOnboarding || "Cadastro inicial"],
    ["Compliance", item.complianceStatus || "Pendente"],
    ["KYC", item.kycStatus || "Pendente"],
    ["Sanções", item.consultaSancoes || "Não consultado"],
    ["PEP", item.exposicaoPep || "Não informado"],
    ["Procurador", procuradorText],
    ["Beneficiário final", beneficiarioText],
    ["Usuários do portal", String(item.portalUsers?.length ?? 0)],
    ["Convites pendentes", String((item.portalUsers ?? []).filter((user) => user.status === "Convite pendente").length)],
    ["Acessos do portal", (item.portalUsers ?? []).length ? (item.portalUsers ?? []).map((user) => `${user.name} · ${user.email} · ${user.status}`).join(" | ") : "Nenhum usuário externo criado"],
    ["Parecer compliance", item.parecerCompliance || "Sem parecer registrado"],
    ["Status", item.status],
  ];
}

function debtorDetailRows(item: Debtor): [string, string][] {
  return [
    ["CNPJ", item.doc],
    ["Nome fantasia", item.nomeFantasia || "Não informado"],
    ["Rating", item.rating],
    ["Exposição", fmt(item.valor)],
    ["Cidade/UF", `${item.cidade || "Não informada"}${item.uf ? `/${item.uf}` : ""}`],
    ["Endereço", item.endereco || "Não informado"],
    ["E-mail geral", item.email || "Não informado"],
    ["Telefone geral", item.telefone || "Não informado"],
    ["Contato financeiro", item.contatoFinanceiroNome ? `${item.contatoFinanceiroNome} · ${item.contatoFinanceiroCargo || "Cargo não informado"}` : "Não cadastrado"],
    ["E-mail financeiro", item.contatoFinanceiroEmail || "Não informado"],
    ["Telefone financeiro", item.contatoFinanceiroTelefone || "Não informado"],
    ["E-mail de confirmação", item.emailConfirmacao || "Não informado"],
    ["Telefone de confirmação", item.telefoneConfirmacao || "Não informado"],
    ["Canal de confirmação", item.canalConfirmacao || "E-mail"],
    ["Janela de confirmação", item.janelaConfirmacao || "Não definida"],
    ["Status da confirmação", item.statusConfirmacao || "Pendente"],
    ["Última confirmação", item.ultimaConfirmacao || "Nunca confirmada"],
    ["Evidência de relacionamento", item.evidenciaRelacionamento || "Não informada"],
    ["Histórico de protestos", item.historicoProtestos || "Não consultado"],
    ["Comportamento de pagamento", item.comportamentoPagamento || "Sem histórico"],
    ["Observação de confirmação", item.observacaoConfirmacao || "Sem observações"],
    ["Observações operacionais", item.observacoesOperacionais || "Sem observações"],
    ["Status operacional", item.status],
  ];
}

function Field({ label, name, value, type, required = true }: { label: string; name: string; value?: string; type?: string; required?: boolean }) {
  const id = `field-${name}`;
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} name={name} defaultValue={value} step={type === "number" ? "0.01" : undefined} type={type} required={required} /></div>;
}

function K({ label, v }: { label: string; v: string }) {
  return <div className="card kpi"><label>{label}</label><b className="mono">{v}</b><small>Atualizado agora</small></div>;
}

function Dashboard({
  cashAccounts,
  data,
  fundingIssues,
  receivables,
  owned,
}: {
  cashAccounts: CashAccount[];
  data: { carteira: number; ativos: number; elegiveis: number; total: number };
  fundingIssues: FundingIssue[];
  receivables: Receivable[];
  owned: Receivable[];
}) {
  const openPortfolio = owned.filter((item) => item.status !== "Liquidado");
  const portfolioFace = openPortfolio.reduce((sum, item) => sum + item.valor, 0);
  const portfolioCost = openPortfolio.reduce((sum, item) => sum + (item.acquisitionValue ?? item.preco ?? priceReceivable(item).purchasePrice), 0);
  const outstanding = openPortfolio.reduce((sum, item) => sum + (item.outstandingValue ?? item.valor), 0);
  const pipeline = receivables.filter((item) => !["Comprado", "Liquidado", "Vencido"].includes(item.status));
  const pipelineValue = pipeline.reduce((sum, item) => sum + item.valor, 0);
  const availableCash = cashAccounts.filter((account) => account.status === "Ativa").reduce((sum, account) => sum + account.balance, 0);
  const issuedFunding = fundingIssues.filter((item) => item.status === "Emitido").reduce((sum, item) => sum + item.amount, 0);
  const fundingUsage = issuedFunding ? outstanding / issuedFunding : 0;
  const avgPrice = portfolioFace ? portfolioCost / portfolioFace : 0;
  const weightedTenor = portfolioFace ? Math.round(openPortfolio.reduce((sum, item) => sum + Math.max(daysFromToday(item.venc), 0) * item.valor, 0) / portfolioFace) : 0;
  const overdue = owned.filter((item) => item.status === "Vencido" || (item.status !== "Liquidado" && daysFromToday(item.venc) < 0));
  const topAssignor = topConcentration(openPortfolio, "ced");
  const topDebtor = topConcentration(openPortfolio, "sac");
  const readiness = [
    { label: "Cadastros-base", ok: receivables.some((item) => item.ced) && receivables.some((item) => item.sac), detail: "Cedente e sacado vinculados aos ativos" },
    { label: "Importação", ok: receivables.length > 0, detail: `${receivables.length} direito(s) creditório(s)` },
    { label: "Elegibilidade", ok: data.elegiveis > 0, detail: `${data.elegiveis} ativo(s) elegível(is)` },
    { label: "Compra", ok: owned.length > 0, detail: `${owned.length} ativo(s) adquirido(s)` },
    { label: "Carteira", ok: outstanding > 0, detail: `${fmt(outstanding)} em aberto` },
  ];
  const statusRows = ["Importado", "Elegível", "Revisão", "Inelegível", "Aprovado", "Comprado", "Vencido", "Liquidado"].map((status) => {
    const items = receivables.filter((item) => item.status === status);
    return { status, count: items.length, value: items.reduce((sum, item) => sum + item.valor, 0) };
  }).filter((item) => item.count > 0);

  return <>
    <div className="kpis executive-kpis">
      <K label="Carteira em aberto" v={fmt(outstanding || data.carteira)} />
      <K label="Pipeline em análise" v={fmt(pipelineValue)} />
      <K label="Caixa disponível" v={fmt(availableCash)} />
      <K label="Uso do funding" v={issuedFunding ? fmtPct(fundingUsage) : "Sem emissão"} />
    </div>
    <div className="grid">
      <div className="card executive-card">
        <div className="ctitle">Resumo executivo</div>
        <div className="metric-grid">
          <div><span>Ativos em carteira</span><b>{data.ativos}</b></div>
          <div><span>Elegíveis para compra</span><b>{data.elegiveis}</b></div>
          <div><span>Preço médio</span><b>{fmtPct(avgPrice)}</b></div>
          <div><span>Prazo médio ponderado</span><b>{weightedTenor} dias</b></div>
          <div><span>Vencidos</span><b>{overdue.length}</b></div>
          <div><span>Funding emitido</span><b>{fmt(issuedFunding)}</b></div>
        </div>
      </div>
      <div className="card executive-card">
        <div className="ctitle">Risco e concentração</div>
        <div className="rule">Maior cedente<b>{topAssignor.name || "Sem carteira"} · {fmtPct(topAssignor.ratio)}</b></div>
        <div className="rule">Maior sacado<b>{topDebtor.name || "Sem carteira"} · {fmtPct(topDebtor.ratio)}</b></div>
        <div className="rule">Saldo aberto<b>{fmt(outstanding)}</b></div>
        <div className="rule">Valor total cadastrado<b>{fmt(data.total)}</b></div>
      </div>
    </div>
    <div className="card mvp-readiness">
      <div>
        <div className="ctitle">Checklist operacional do MVP</div>
        <p className="muted">Visão rápida do fluxo mínimo: cadastro → upload → elegibilidade → compra → carteira.</p>
      </div>
      <div className="mvp-readiness-grid">
        {readiness.map((item) => (
          <div className={item.ok ? "ready" : ""} key={item.label}>
            <span>{item.ok ? "OK" : "Pendente"}</span>
            <b>{item.label}</b>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>
    </div>
    <div className="grid">
      <div className="card">
        <div className="ctitle">Exposição por status</div>
        <Table heads={["Status", "Quantidade", "Valor", "% do total"]}>
          {statusRows.map((row) => (
            <tr key={row.status}>
              <td><Badge v={row.status} /></td>
              <td>{row.count}</td>
              <td className="mono">{fmt(row.value)}</td>
              <td>{fmtPct(data.total ? row.value / data.total : 0)}</td>
            </tr>
          ))}
        </Table>
      </div>
      <div className="card">
        <div className="ctitle">Próximas decisões</div>
        {pipeline.slice(0, 6).map((item) => (
          <div className="audit" key={item.id}>
            <span className="mono">{item.id}</span>
            <b>{item.ced} → {item.sac}</b>
            <small>{fmt(item.valor)} · {item.status} · venc. {item.venc}</small>
          </div>
        ))}
        {!pipeline.length && <div className="note">Nenhum ativo pendente de decisão.</div>}
      </div>
    </div>
    <Assets ds={receivables} owned={owned.map((item) => item.id)} />
  </>;
}

function AlertsPage({ checklists, entries, fundingIssues, receivables }: { checklists: DocumentChecklist[]; entries: BankStatementEntry[]; fundingIssues: FundingIssue[]; receivables: Receivable[] }) {
  const portfolio = receivables.filter((item) => item.portfolioStatus || ["Comprado", "Vencido", "Liquidado"].includes(item.status));
  const openPortfolio = portfolio.filter((item) => item.status !== "Liquidado");
  const openExposure = openPortfolio.reduce((sum, item) => sum + (item.outstandingValue ?? item.valor), 0);
  const issuedFunding = fundingIssues.filter((item) => item.status === "Emitido").reduce((sum, item) => sum + item.amount, 0);
  const pendingDocs = checklists.filter((item) => !item.ok);
  const pendingReconciliation = entries.filter((item) => item.status === "Pendente");
  const divergentReconciliation = entries.filter((item) => item.status === "Divergente");
  const overdue = openPortfolio.filter((item) => item.status === "Vencido" || daysFromToday(item.venc) < 0);
  const review = receivables.filter((item) => item.status === "Revisão" || item.status === "Inelegível");
  const readyForPurchase = receivables.filter((item) => ["Elegível", "Aprovado"].includes(item.status));
  const priorityScore: Record<string, number> = { Crítico: 100, Alto: 75, Médio: 50, Baixo: 25 };
  const alerts = [
    ...overdue.map((item) => ({ priority: "Crítico", area: "Cobrança", owner: "Cobrança", sla: "Hoje", amount: item.outstandingValue ?? item.valor, title: `Ativo vencido ${item.id}`, detail: `${item.sac} · venc. ${item.venc}`, action: "Registrar cobrança, evidência ou liquidação" })),
    ...divergentReconciliation.map((item) => ({ priority: "Crítico", area: "Caixa", owner: "Tesouraria", sla: "Hoje", amount: item.amount, title: `Divergência de extrato ${item.id}`, detail: `${item.accountName ?? item.accountId} · ${item.description}`, action: "Investigar diferença com banco/razão" })),
    ...pendingDocs.map((item) => ({ priority: "Alto", area: "Documentos", owner: "Cadastro/Compliance", sla: "D+1", amount: receivables.find((asset) => asset.id === item.receivableId)?.valor ?? 0, title: `Pendência documental ${item.receivableId}`, detail: item.gaps.map((gap) => gap.label).join(" · "), action: "Regularizar antes de compra" })),
    ...readyForPurchase.filter((item) => !pendingDocs.some((doc) => doc.receivableId === item.id)).map((item) => ({ priority: "Alto", area: "Compra", owner: "Operações", sla: "D+1", amount: item.valor, title: `Ativo pronto para compra ${item.id}`, detail: `${item.ced} → ${item.sac}`, action: "Simular boleta/apreçamento e enviar para compra" })),
    ...pendingReconciliation.map((item) => ({ priority: "Médio", area: "Caixa", owner: "Tesouraria", sla: "D+2", amount: item.amount, title: `Extrato pendente ${item.id}`, detail: `${item.description} · ${fmt(item.amount)}`, action: "Conciliar com movimento de caixa" })),
    ...review.map((item) => ({ priority: "Médio", area: "Crédito", owner: "Risco", sla: "D+2", amount: item.valor, title: `Ativo em revisão ${item.id}`, detail: `${item.ced} → ${item.sac}`, action: "Enviar para comitê ou ajustar documentação" })),
  ].sort((a, b) => (priorityScore[b.priority] + b.amount / 1000000) - (priorityScore[a.priority] + a.amount / 1000000));
  if (issuedFunding > 0 && openExposure / issuedFunding > 0.9) {
    alerts.unshift({ priority: "Crítico", area: "Funding", owner: "Capital Markets", sla: "Hoje", amount: Math.max(0, openExposure - issuedFunding * 0.9), title: "Uso de funding acima de 90%", detail: `${fmt(openExposure)} / ${fmt(issuedFunding)}`, action: "Reduzir compras ou estruturar nova emissão" });
  }
  const critical = alerts.filter((item) => item.priority === "Crítico").length;
  const high = alerts.filter((item) => item.priority === "Alto").length;
  const medium = alerts.filter((item) => item.priority === "Médio").length;
  const amountAtRisk = alerts.reduce((sum, item) => sum + item.amount, 0);
  const areaSummary = alerts.reduce<Record<string, { count: number; amount: number; critical: number }>>((acc, alert) => {
    const current = acc[alert.area] ?? { count: 0, amount: 0, critical: 0 };
    current.count += 1;
    current.amount += alert.amount;
    current.critical += alert.priority === "Crítico" ? 1 : 0;
    acc[alert.area] = current;
    return acc;
  }, {});
  const firstAction = alerts[0];
  return <>
    <div className="kpis">
      <K label="Alertas críticos" v={String(critical)} />
      <K label="Alta prioridade" v={String(high)} />
      <K label="Valor monitorado" v={fmt(amountAtRisk)} />
      <K label="Pendências totais" v={`${alerts.length} (${medium} médias)`} />
    </div>
    <div className="card alert-command">
      <div>
        <div className="ctitle">Comando executivo</div>
        <p className="muted">Fila única de prioridades cruzando cobrança, caixa, documentos, risco, compra e funding.</p>
      </div>
      <div className="alert-command-next">
        <span>Próxima melhor ação</span>
        <b>{firstAction?.title ?? "Sem ação pendente"}</b>
        <small>{firstAction ? `${firstAction.owner} · ${firstAction.sla} · ${firstAction.action}` : "Operação sem pendências críticas."}</small>
      </div>
    </div>
    <div className="alert-area-grid">
      {Object.entries(areaSummary).map(([area, summary]) => (
        <div key={area}>
          <span>{area}</span>
          <b>{summary.count}</b>
          <small>{fmt(summary.amount)} · {summary.critical} crítico(s)</small>
        </div>
      ))}
    </div>
    <div className="grid">
      <div className="card">
        <div className="ctitle">Fila executiva</div>
        <Table heads={["Prioridade", "Área", "Dono", "SLA", "Valor", "Pendência", "Detalhe", "Ação recomendada"]}>
          {alerts.map((alert, index) => (
            <tr key={`${alert.title}-${index}`}>
              <td><Badge v={alert.priority} /></td>
              <td>{alert.area}</td>
              <td>{alert.owner}</td>
              <td className="mono">{alert.sla}</td>
              <td className="mono">{fmt(alert.amount)}</td>
              <td>{alert.title}</td>
              <td>{alert.detail}</td>
              <td>{alert.action}</td>
            </tr>
          ))}
        </Table>
        {!alerts.length && <div className="note">Nenhuma pendência operacional relevante no momento.</div>}
      </div>
      <div className="card">
        <div className="ctitle">Rotina de acompanhamento</div>
        {[
          "Críticos devem ter dono e SLA para o mesmo dia.",
          "Compras só avançam quando documentos mínimos e caixa estiverem endereçados.",
          "Divergência de extrato exige conciliação manual ou justificativa auditável.",
          "Funding acima do limite de uso deve ir para decisão executiva antes de novas compras.",
        ].map((rule) => <div className="rule" key={rule}>{rule}<Check size={14} color="#70c69a" /></div>)}
      </div>
    </div>
  </>;
}

function PipelinePage({ receivables }: { receivables: Receivable[] }) {
  const stages = [
    { keys: ["Importado"], title: "1. Importação", hint: "Arquivo recebido e pré-validado", action: "Rodar motor de elegibilidade" },
    { keys: ["Revisão", "Inelegível"], title: "2. Exceções", hint: "Pendências de regra, cadastro ou documento", action: "Resolver ou enviar ao comitê" },
    { keys: ["Elegível"], title: "3. Elegibilidade", hint: "Ativos aprovados pelo motor", action: "Simular aquisição" },
    { keys: ["Aprovado"], title: "4. Comitê", hint: "Exceções aprovadas formalmente", action: "Gerar boleta" },
    { keys: ["Comprado"], title: "5. Carteira", hint: "Direitos adquiridos no warehouse", action: "Monitorar cobrança" },
    { keys: ["Vencido"], title: "6. Cobrança", hint: "Ativos vencidos ou em atraso", action: "Registrar ação de cobrança" },
    { keys: ["Liquidado"], title: "7. Liquidação", hint: "Baixa operacional e conferência de caixa", action: "Conciliar recebimento" },
  ];
  const total = receivables.reduce((sum, item) => sum + item.valor, 0);
  const stuck = receivables.filter((item) => ["Revisão", "Inelegível", "Vencido"].includes(item.status));
  const ready = receivables.filter((item) => ["Elegível", "Aprovado"].includes(item.status));
  const portfolio = receivables.filter((item) => ["Comprado", "Vencido", "Liquidado"].includes(item.status));
  const imported = receivables.filter((item) => item.status === "Importado");
  return <>
    <div className="kpis">
      <K label="Ativos na esteira" v={String(receivables.length)} />
      <K label="Valor total" v={fmt(total)} />
      <K label="Prontos para compra" v={String(ready.length)} />
      <K label="Gargalos" v={String(stuck.length)} />
    </div>
    <div className="pipeline-summary">
      <div><span>Entrada</span><b>{imported.length}</b><small>{fmt(imported.reduce((sum, item) => sum + item.valor, 0))}</small></div>
      <div><span>Compra possível</span><b>{ready.length}</b><small>{fmt(ready.reduce((sum, item) => sum + item.valor, 0))}</small></div>
      <div><span>Em carteira / baixados</span><b>{portfolio.length}</b><small>{fmt(portfolio.reduce((sum, item) => sum + item.valor, 0))}</small></div>
      <div><span>Conversão</span><b>{Math.round((portfolio.length / Math.max(receivables.length, 1)) * 100)}%</b><small>por quantidade de ativos</small></div>
    </div>
    <div className="pipeline">
      {stages.map((stage) => {
        const items = receivables.filter((item) => stage.keys.includes(item.status));
        const value = items.reduce((sum, item) => sum + item.valor, 0);
        return (
          <div className="pipe-col" key={stage.title}>
            <div className="pipe-head">
              <b>{stage.title}</b>
              <small>{items.length} ativo(s) · {fmt(value)}</small>
            </div>
            <div className="note">{stage.hint}</div>
            {items.slice(0, 8).map((item) => (
              <div className="pipe-card" key={item.id}>
                <div className="pipe-card-top"><span className="mono">{item.id}</span><Badge v={item.portfolioStatus ?? item.status} /></div>
                <b>{fmt(item.valor)}</b>
                <small>{item.ced}</small>
                <small>{item.sac} · venc. {item.venc}</small>
              </div>
            ))}
            {!items.length && <div className="empty-pipe">Sem ativos</div>}
            <div className="pipe-action">{stage.action}</div>
          </div>
        );
      })}
    </div>
    <div className="card">
      <div className="ctitle">Pontos de atenção da esteira</div>
      <Table heads={["Ativo", "Status", "Cedente", "Sacado", "Valor", "Próxima ação"]}>
        {stuck.map((item) => (
          <tr key={item.id}>
            <td className="mono">{item.id}</td>
            <td><Badge v={item.status} /></td>
            <td>{item.ced}</td>
            <td>{item.sac}</td>
            <td>{fmt(item.valor)}</td>
            <td>{item.status === "Vencido" ? "Cobrança imediata" : item.status === "Inelegível" ? "Comitê ou reprovação formal" : "Resolver pendência de elegibilidade"}</td>
          </tr>
        ))}
      </Table>
    </div>
  </>;
}

function EntityPage({ children, heads, q, setQ }: { addLabel: string; canCreate: boolean; heads: string[]; onAdd: () => void; q: string; setQ: (value: string) => void; children: ReactNode }) {
  return <>
    <div className="filters"><input placeholder="Buscar por nome ou CNPJ..." value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn">Filtros</button></div>
    <div className="card"><Table heads={heads}>{children}</Table></div>
  </>;
}

function CessionJourneyPage({
  annualRate,
  assignors,
  batches,
  cashAccounts,
  cessionOperations,
  createOperation,
  debtors,
  documentChecklists,
  fundingIssues,
  owned,
  receivables,
  serviceFeeBps,
  setModal,
  setView,
  updateOperation,
}: {
  annualRate: number;
  assignors: Assignor[];
  batches: ImportBatch[];
  cashAccounts: CashAccount[];
  cessionOperations: CessionOperation[];
  createOperation: (input: { title: string; status: string; currentStep: string; faceValue: number; purchaseValue: number; readyCount: number; blockedCount: number; snapshot: unknown }) => void;
  debtors: Debtor[];
  documentChecklists: DocumentChecklist[];
  fundingIssues: FundingIssue[];
  owned: Receivable[];
  receivables: Receivable[];
  serviceFeeBps: number;
  setModal: (modal: Modal) => void;
  setView: (view: View) => void;
  updateOperation: (operation: CessionOperation, status: string, currentStep: string) => void;
}) {
  const openReceivables = receivables.filter((item) => !["Comprado", "Liquidado"].includes(item.status));
  const imported = receivables.filter((item) => item.status === "Importado");
  const review = receivables.filter((item) => item.status === "Revisão" || item.status === "Inelegível");
  const ready = receivables.filter((item) => item.status === "Elegível" || item.status === "Aprovado");
  const confirmed = receivables.filter((item) => validConfirmationStatuses.includes(item.confirmationStatus ?? ""));
  const pricedRows = ready.map((item) => {
    const pricing = item.pricing?.pricingSteps?.length ? item.pricing : priceReceivable(item, annualRate / 100, serviceFeeBps);
    return {
      item,
      pricing,
      readiness: buildPurchaseReadiness(item, pricing, assignors, debtors, documentChecklists, cashAccounts),
    };
  });
  const readyRows = pricedRows.filter((row) => row.readiness.status === "Pronto");
  const blockedRows = pricedRows.filter((row) => row.readiness.status !== "Pronto");
  const faceValue = readyRows.reduce((sum, row) => sum + row.item.valor, 0);
  const purchaseValue = readyRows.reduce((sum, row) => sum + row.pricing.purchasePrice, 0);
  const discount = faceValue ? 1 - purchaseValue / faceValue : 0;
  const weightedRate = faceValue ? readyRows.reduce((sum, row) => sum + row.pricing.annualRate * row.item.valor, 0) / faceValue : annualRate / 100;
  const purchaseAccount = cashAccounts.find((account) => account.purpose === "PURCHASE_SETTLEMENT" && account.status === "Ativa" && !account.deletedAt);
  const fundingCapacity = fundingIssues.filter((issue) => issue.status !== "Liquidado").reduce((sum, issue) => sum + issue.amount, 0);
  const cashCoverage = purchaseValue ? (purchaseAccount?.balance ?? 0) / purchaseValue : 0;
  const latestBatch = batches[0];
  const activeAssignors = assignors.filter((item) => !item.deletedAt);
  const activeDebtors = debtors.filter((item) => !item.deletedAt);
  const activeOperation = cessionOperations.find((item) => !["Concluída", "Cancelada"].includes(item.status)) ?? cessionOperations[0];
  const nextAction =
    !activeAssignors.length ? { label: "Cadastrar cedente", view: "cedentes" as View } :
    !activeDebtors.length ? { label: "Cadastrar sacado", view: "sacados" as View } :
    !receivables.length ? { label: "Importar duplicatas", modal: "upload" as Modal } :
    imported.length ? { label: "Rodar elegibilidade", view: "elegibilidade" as View } :
    !confirmed.length && openReceivables.length ? { label: "Gerar confirmações", view: "confirmacao" as View } :
    review.length ? { label: "Enviar ao comitê", view: "comite" as View } :
    readyRows.length ? { label: "Comprar ativos", view: "compra" as View } :
    { label: "Monitorar carteira", view: "carteira" as View };
  const journeySteps = [
    {
      title: "1. Simulação",
      status: receivables.length ? "Em andamento" : "Aguardando títulos",
      metric: fmt(receivables.reduce((sum, item) => sum + item.valor, 0)),
      detail: `${receivables.length} título(s) carregado(s) para análise`,
      action: () => setView("jornada"),
    },
    {
      title: "2. Upload de títulos",
      status: latestBatch ? latestBatch.status : "Pendente",
      metric: latestBatch ? latestBatch.fileName : "Sem lote",
      detail: latestBatch ? `${latestBatch.validRows}/${latestBatch.totalRows} linhas válidas` : "Importe CSV/XLSX para iniciar a cessão",
      action: () => setModal("upload"),
    },
    {
      title: "3. Validação",
      status: imported.length ? "Pendente" : ready.length ? "Validado" : "Aguardando",
      metric: `${ready.length} elegível(is)`,
      detail: `${review.length} em revisão · ${imported.length} importado(s) sem motor`,
      action: () => setView("elegibilidade"),
    },
    {
      title: "4. Confirmação",
      status: confirmed.length ? "Com evidência" : "Pendente",
      metric: `${confirmed.length}/${openReceivables.length || receivables.length}`,
      detail: "Aceite, dispensa ou divergência por sacado",
      action: () => setView("confirmacao"),
    },
    {
      title: "5. Comitê",
      status: review.length ? "Exceções abertas" : "Sem fila crítica",
      metric: fmt(review.reduce((sum, item) => sum + item.valor, 0)),
      detail: "Aprovação de exceções e bloqueios",
      action: () => setView("comite"),
    },
    {
      title: "6. Conta e funding",
      status: cashCoverage >= 1 ? "Coberto" : purchaseValue ? "Atenção" : "Aguardando compra",
      metric: purchaseAccount ? fmt(purchaseAccount.balance ?? 0) : "Sem conta",
      detail: `${fmt(fundingCapacity)} em funding cadastrado`,
      action: () => setView("caixa"),
    },
    {
      title: "7. Compra",
      status: readyRows.length ? "Pronto para compra" : "Sem lote pronto",
      metric: fmt(purchaseValue),
      detail: `${readyRows.length} pronto(s) · ${blockedRows.length} bloqueado(s)`,
      action: () => setView("compra"),
    },
    {
      title: "8. Carteira",
      status: owned.length ? "Ativa" : "Sem ativos",
      metric: fmt(owned.reduce((sum, item) => sum + (item.outstandingValue ?? item.valor), 0)),
      detail: `${owned.length} ativo(s) em warehouse`,
      action: () => setView("carteira"),
    },
  ];
  const concentration = Object.entries(readyRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.item.sac] = (acc[row.item.sac] ?? 0) + row.item.valor;
    return acc;
  }, {}))
    .map(([name, value]) => ({ name, value, pct: faceValue ? value / faceValue : 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);
  const operationSnapshot = {
    generatedAt: new Date().toISOString(),
    receivables: readyRows.map((row) => row.item.id),
    latestBatch: latestBatch?.id ?? null,
    faceValue,
    purchaseValue,
    discount,
    weightedRate,
    cashCoverage,
  };
  const blockerPlaybook: Record<string, { owner: string; sla: string; action: string; view?: View; modal?: Modal }> = {
    "Cedente ativo": { owner: "Cadastro", sla: "D+1", action: "Regularizar cadastro do cedente", view: "cedentes" },
    "Sacado ativo": { owner: "Cadastro", sla: "D+1", action: "Completar cadastro e contatos do sacado", view: "sacados" },
    "Confirmação registrada": { owner: "Operações", sla: "D+0", action: "Gerar link ou lançar confirmação manual", view: "confirmacao" },
    "Documentos mínimos": { owner: "Cadastro/Compliance", sla: "D+1", action: "Anexar lastro, contrato ou evidência", view: "documentos" },
    Elegibilidade: { owner: "Risco", sla: "D+0", action: "Rodar motor e revisar regras", view: "elegibilidade" },
    "Limite do cedente": { owner: "Crédito", sla: "D+1", action: "Revisar limite ou levar exceção", view: "cedentes" },
    "Rating do sacado": { owner: "Crédito", sla: "D+1", action: "Atualizar rating do sacado", view: "sacados" },
    "Prazo do ativo": { owner: "Comitê", sla: "D+1", action: "Deliberar exceção de prazo", view: "comite" },
    "Preço de aquisição": { owner: "Mesa", sla: "D+0", action: "Revisar taxa, tarifa ou apreçamento", view: "compra" },
    "Conta de liquidação": { owner: "Tesouraria", sla: "D+0", action: "Configurar conta de compra", view: "caixa" },
    "Alçada de exceção": { owner: "Comitê", sla: "D+1", action: "Submeter exceção de deságio", view: "comite" },
  };
  const blockerMap = blockedRows.reduce<Record<string, { label: string; detail: string; count: number; amount: number }>>((acc, row) => {
    row.readiness.blockers.forEach((blocker) => {
      const current = acc[blocker.label] ?? { label: blocker.label, detail: blocker.detail, count: 0, amount: 0 };
      current.count += 1;
      current.amount += row.item.valor;
      current.detail = blocker.detail;
      acc[blocker.label] = current;
    });
    return acc;
  }, {});
  const commandRows = [
    ...(!activeOperation ? [{
      label: "Operação não registrada",
      detail: "A jornada ainda não possui trilha operacional persistida",
      count: 1,
      amount: purchaseValue,
      owner: "Operações",
      sla: "D+0",
      action: "Registrar operação",
      run: () => createOperation({
        title: `Cessão warehouse · ${new Date().toLocaleDateString("pt-BR")}`,
        status: readyRows.length ? "Validação" : "Simulação",
        currentStep: readyRows.length ? "Validação" : "Simulação",
        faceValue,
        purchaseValue,
        readyCount: readyRows.length,
        blockedCount: blockedRows.length,
        snapshot: operationSnapshot,
      }),
    }] : []),
    ...(imported.length ? [{
      label: "Elegibilidade pendente",
      detail: "Há títulos importados sem passagem pelo motor",
      count: imported.length,
      amount: imported.reduce((sum, item) => sum + item.valor, 0),
      owner: "Risco",
      sla: "D+0",
      action: "Rodar elegibilidade",
      run: () => setView("elegibilidade"),
    }] : []),
    ...(review.length ? [{
      label: "Exceções abertas",
      detail: "Títulos em revisão ou inelegíveis precisam de decisão",
      count: review.length,
      amount: review.reduce((sum, item) => sum + item.valor, 0),
      owner: "Comitê",
      sla: "D+1",
      action: "Enviar ao comitê",
      run: () => setView("comite"),
    }] : []),
    ...(purchaseValue && cashCoverage < 1 ? [{
      label: "Caixa insuficiente",
      detail: `Faltam ${fmt(Math.max(purchaseValue - (purchaseAccount?.balance ?? 0), 0))} na conta de liquidação`,
      count: 1,
      amount: Math.max(purchaseValue - (purchaseAccount?.balance ?? 0), 0),
      owner: "Tesouraria",
      sla: "D+0",
      action: "Reforçar conta/funding",
      run: () => setView("caixa"),
    }] : []),
    ...Object.values(blockerMap).map((blocker) => {
      const playbook = blockerPlaybook[blocker.label] ?? { owner: "Operações", sla: "D+1", action: "Regularizar pendência", view: "alertas" as View };
      return {
        ...blocker,
        ...playbook,
        run: () => {
          if (playbook.modal) setModal(playbook.modal);
          else if (playbook.view) setView(playbook.view);
        },
      };
    }),
  ].sort((a, b) => b.amount - a.amount);

  return (
    <>
      <div className="kpis">
        <K label="Valor simulado" v={fmt(faceValue)} />
        <K label="Valor de compra" v={fmt(purchaseValue)} />
        <K label="Deságio estimado" v={fmtPct(discount)} />
        <K label="Taxa média" v={fmtPct(weightedRate)} />
      </div>
      <div className="card journey-hero-card">
        <div>
          <div className="ctitle">Jornada operacional da cessão</div>
          <p className="muted">Uma visão única para conduzir o lote da simulação até a entrada na carteira warehouse.</p>
        </div>
        <div className="journey-actions">
          <button
            className="btn"
            onClick={() => createOperation({
              title: `Cessão warehouse · ${new Date().toLocaleDateString("pt-BR")}`,
              status: readyRows.length ? "Validação" : "Simulação",
              currentStep: readyRows.length ? "Validação" : "Simulação",
              faceValue,
              purchaseValue,
              readyCount: readyRows.length,
              blockedCount: blockedRows.length,
              snapshot: operationSnapshot,
            })}
          >
            Registrar operação
          </button>
          <button
            className="btn gold"
            onClick={() => {
              if ("modal" in nextAction) setModal(nextAction.modal ?? null);
              else setView(nextAction.view);
            }}
          >
            {nextAction.label}
          </button>
        </div>
      </div>
      {activeOperation && (
        <div className="card cession-operation-card">
          <div>
            <span>Operação ativa</span>
            <b>{activeOperation.id}</b>
            <small>{activeOperation.title} · {activeOperation.updatedAt}</small>
          </div>
          <div>
            <span>Status</span>
            <b>{activeOperation.status}</b>
            <small>Etapa atual: {activeOperation.currentStep}</small>
          </div>
          <div>
            <span>Valores</span>
            <b>{fmt(activeOperation.purchaseValue)}</b>
            <small>{activeOperation.readyCount} pronto(s) · {activeOperation.blockedCount} bloqueado(s)</small>
          </div>
          <div className="cession-operation-actions">
            <button className="mini" onClick={() => updateOperation(activeOperation, "Validação", "Validação")}>Validação</button>
            <button className="mini" onClick={() => updateOperation(activeOperation, "Aprovação", "Comitê")}>Comitê</button>
            <button className="mini" onClick={() => updateOperation(activeOperation, "Compra", "Compra")}>Compra</button>
            <button className="mini" onClick={() => updateOperation(activeOperation, "Concluída", "Carteira")}>Concluir</button>
          </div>
        </div>
      )}
      <div className="journey-grid">
        {journeySteps.map((step) => (
          <button className="journey-step card" key={step.title} onClick={step.action}>
            <span>{step.title}</span>
            <b>{step.metric}</b>
            <em>{step.status}</em>
            <small>{step.detail}</small>
          </button>
        ))}
      </div>
      <div className="card cession-command-board">
        <div>
          <div className="ctitle">Comando de pendências da cessão</div>
          <p className="muted">Fila única de bloqueios, responsáveis e ações para destravar a compra do lote.</p>
        </div>
        {commandRows.length ? (
          <Table heads={["Pendência", "Impacto", "Responsável", "SLA", "Ação"]}>
            {commandRows.slice(0, 8).map((row) => (
              <tr key={`${row.label}-${row.owner}`}>
                <td>
                  <div className="entity">{row.label}</div>
                  <div className="sub">{row.detail}</div>
                </td>
                <td>
                  <div className="mono">{fmt(row.amount)}</div>
                  <div className="sub">{row.count} ocorrência(s)</div>
                </td>
                <td>{row.owner}</td>
                <td><Badge v={row.sla} /></td>
                <td><button className="mini" onClick={row.run}>{row.action}</button></td>
              </tr>
            ))}
          </Table>
        ) : (
          <div className="note">Sem bloqueios relevantes. O lote pronto pode seguir para boleta de compra.</div>
        )}
      </div>
      <div className="grid access-grid">
        <div className="card">
          <div className="ctitle">Simulação consolidada do lote pronto</div>
          <div className="simulation-panel">
            <div><span>Face value</span><b>{fmt(faceValue)}</b></div>
            <div><span>Compra estimada</span><b>{fmt(purchaseValue)}</b></div>
            <div><span>Desconto</span><b>{fmt(faceValue - purchaseValue)}</b></div>
            <div><span>Caixa após compra</span><b>{fmt((purchaseAccount?.balance ?? 0) - purchaseValue)}</b></div>
          </div>
          <Table heads={["Ativo", "Cedente / Sacado", "Vencimento", "Face", "Preço", "Prontidão"]}>
            {pricedRows.slice(0, 8).map((row) => (
              <tr key={row.item.id}>
                <td className="mono">{row.item.id}</td>
                <td><div className="entity">{row.item.ced}</div><div className="sub">{row.item.sac}</div></td>
                <td>{row.item.venc}</td>
                <td className="mono">{fmt(row.item.valor)}</td>
                <td className="mono">{fmt(row.pricing.purchasePrice)}</td>
                <td><Badge v={row.readiness.status} /><div className="sub">{row.readiness.blockers[0]?.label ?? row.readiness.warnings[0]?.label ?? "Sem pendência crítica"}</div></td>
              </tr>
            ))}
          </Table>
          {!pricedRows.length && <div className="note">Nenhum ativo elegível ou aprovado para simulação. Importe títulos e rode o motor de elegibilidade.</div>}
        </div>
        <div className="card">
          <div className="ctitle">Pendências e concentração</div>
          <div className="rule">Títulos sem elegibilidade<b>{imported.length}</b></div>
          <div className="rule">Exceções para comitê<b>{review.length}</b></div>
          <div className="rule">Prontos bloqueados por checklist<b>{blockedRows.length}</b></div>
          <div className="rule">Cobertura de caixa<b>{purchaseValue ? fmtPct(Math.min(cashCoverage, 9.99)) : "N/A"}</b></div>
          <div className="ctitle">Top sacados do lote</div>
          {concentration.length ? concentration.map((row) => <div className="rule" key={row.name}>{row.name}<b>{fmtPct(row.pct)}</b></div>) : <div className="note">Sem lote elegível para análise de concentração.</div>}
          {activeOperation && (
            <>
              <div className="ctitle">Histórico da operação</div>
              {activeOperation.events.length ? activeOperation.events.slice(0, 5).map((event) => (
                <div className="audit" key={event.id}>
                  <span className="mono">{event.at}</span>
                  <b>{event.step}</b>
                  <small>{event.notes || event.action}</small>
                </div>
              )) : <div className="note">Sem eventos registrados.</div>}
            </>
          )}
          <div className="actions">
            <button className="btn" onClick={() => setView("documentos")}>Ver documentos</button>
            <button className="btn" onClick={() => setView("risco")}>Risco e covenants</button>
          </div>
        </div>
      </div>
    </>
  );
}

function ImportPage({ batches, receivables, owned }: { batches: ImportBatch[]; receivables: Receivable[]; owned: Receivable[] }) {
  return <>
    <Flow />
    <div className="grid">
      <div className="card"><div className="ctitle">Lotes importados</div><Table heads={["Lote", "Arquivo", "Status", "Linhas", "Válidas", "Erros"]}>{batches.map((b) => <tr key={b.id}><td className="mono">{b.id}</td><td>{b.fileName}</td><td><Badge v={b.status} /></td><td>{b.totalRows}</td><td>{b.validRows}</td><td>{b.invalidRows}</td></tr>)}</Table></div>
      <div className="card"><div className="ctitle">Modelo esperado</div><div className="note">CSV: <span className="mono">id;cedente;sacado;emissao;vencimento;valor</span><br />Arquivos XLSX são aceitos no fluxo e processados como pré-validação demonstrativa até a entrada do parser dedicado.</div></div>
    </div>
    <Assets ds={receivables} owned={owned.map((item) => item.id)} />
  </>;
}

function ConfirmationPage({
  links,
  receivables,
  owned,
  onConfirm,
  onGenerateLink,
}: {
  links: Record<string, ConfirmationLinkState>;
  receivables: Receivable[];
  owned: Receivable[];
  onConfirm: (item: Receivable) => void;
  onGenerateLink: (item: Receivable) => void;
}) {
  const ownedIds = owned.map((item) => item.id);
  const pending = receivables.filter((item) => (item.confirmationStatus ?? "Pendente") === "Pendente").length;
  const confirmed = receivables.filter((item) => item.confirmationStatus === "Confirmado").length;
  const divergent = receivables.filter((item) => item.confirmationStatus === "Divergente" || item.confirmationStatus === "Sem resposta").length;
  const operational = receivables.filter((item) => !ownedIds.includes(item.id) && item.status !== "Liquidado");

  return <>
    <div className="kpis">
      <K label="Pendentes" v={String(pending)} />
      <K label="Confirmadas" v={String(confirmed)} />
      <K label="Divergentes / sem resposta" v={String(divergent)} />
      <K label="Valor pendente" v={fmt(receivables.filter((item) => (item.confirmationStatus ?? "Pendente") === "Pendente").reduce((sum, item) => sum + item.valor, 0))} />
    </div>
    <div className="card">
      <div className="ctitle">Esteira de confirmação por duplicata</div>
      <Table heads={["Ativo", "Cedente / Sacado", "Vencimento", "Valor", "Confirmação", "Evidência", "Status ativo", "Link seguro", "Ação"]}>
        {operational.map((item) => (
          <tr key={item.id}>
            <td className="mono">{item.id}</td>
            <td><div className="entity">{item.ced}</div><div className="sub">{item.sac}</div></td>
            <td>{item.venc}</td>
            <td className="mono">{fmt(item.valor)}</td>
            <td><Badge v={item.confirmationStatus ?? "Pendente"} /><div className="sub">{item.confirmationChannel ?? "E-mail"}{item.confirmedAt ? ` · ${item.confirmedAt}` : ""}</div></td>
            <td><div className="entity">{item.confirmationEvidence || "Sem evidência"}</div><div className="sub">{item.confirmationNotes || "Sem observações"}</div></td>
            <td><Badge v={item.status} /></td>
            <td>
              {links[item.id] ? (
                <div className="secure-link-cell">
                  <div className="row-actions">
                    <button className="btn" onClick={() => navigator.clipboard?.writeText(links[item.id].link)}>Copiar link</button>
                  </div>
                  <div className="sub">{links[item.id].link}</div>
                  <div className="sub">Envio manual pela equipe operacional</div>
                </div>
              ) : (
                <button className="btn" onClick={() => onGenerateLink(item)}>Gerar link</button>
              )}
            </td>
            <td><button className="btn" onClick={() => onConfirm(item)}>Registrar manual</button></td>
          </tr>
        ))}
      </Table>
    </div>
    <div className="notice soft-notice">
      <span>Fluxo atual: gere o link, envie manualmente pelo canal operacional e registre manualmente a confirmação recebida no app. Respostas pelo link continuam auditáveis se o sacado usar a página pública.</span>
    </div>
  </>;
}

function EligibilityPage({ receivables, owned, runRules }: { receivables: Receivable[]; owned: Receivable[]; runRules: () => void }) {
  const eligible = receivables.filter((item) => item.status === "Elegível").length;
  const evaluated = receivables.filter((item) => item.eligibility).length;
  const averageScore = evaluated ? Math.round(receivables.reduce((sum, item) => sum + (item.eligibility?.score ?? 0), 0) / evaluated) : 0;
  const policyRules = [
    "Cedente ativo",
    "Sacado ativo",
    "Prazo máximo 120 dias",
    "Rating mínimo BBB",
    "Contato de confirmação do sacado",
    "Status de confirmação do sacado",
    "Limite disponível",
  ];
  return <>
    <div className="kpis"><K label="Títulos analisados" v={String(receivables.length)} /><K label="Valor total" v={fmt(receivables.reduce((a, d) => a + d.valor, 0))} /><K label="Elegíveis" v={`${Math.round((eligible / Math.max(receivables.length, 1)) * 100)}%`} /><K label="Score médio" v={`${averageScore}%`} /></div>
    <div className="grid"><Assets ds={receivables} owned={owned.map((item) => item.id)} /><div className="card"><div className="ctitle">Política v1.5 · motor versionado</div><div className="policy-version-card"><span>POL-WH-ELIG</span><b>Versão 15 · vigente desde 08/07/2026</b><small>Snapshot da política é gravado em cada avaliação e no audit log do processamento.</small></div>{policyRules.map((x) => <div className="rule" key={x}>{x}<Check size={14} color="#70c69a" /></div>)}<div className="note">Divergência ou bloqueio na confirmação torna o ativo inelegível. Pendência, ausência de contato ou sem resposta direciona para revisão.</div><div className="actions"><button className="btn gold" onClick={runRules}>Reprocessar elegibilidade</button></div></div></div>
  </>;
}

function CommitteePage({ receivables, onDecide }: { receivables: Receivable[]; onDecide: (item: Receivable) => void }) {
  const queue = receivables.filter((item) => item.status === "Revisão" || item.status === "Inelegível");
  const approved = receivables.filter((item) => item.status === "Aprovado");
  const reviewValue = queue.reduce((sum, item) => sum + item.valor, 0);

  return <>
    <div className="kpis">
      <K label="Em comitê" v={String(queue.length)} />
      <K label="Valor em exceção" v={fmt(reviewValue)} />
      <K label="Aprovados por exceção" v={String(approved.length)} />
      <K label="Ticket médio" v={fmt(queue.length ? reviewValue / queue.length : 0)} />
    </div>
    <div className="card">
      <div className="ctitle">Fila de exceções e decisões</div>
      <Table heads={["Ativo", "Cedente / Sacado", "Vencimento", "Valor", "Confirmação", "Status", "Governança"]}>
        {queue.map((item) => (
          <tr key={item.id}>
            <td className="mono">{item.id}</td>
            <td><div className="entity">{item.ced}</div><div className="sub">{item.sac}</div></td>
            <td>{item.venc}</td>
            <td className="mono">{fmt(item.valor)}</td>
            <td><Badge v={item.confirmationStatus ?? "Pendente"} /><div className="sub">{item.confirmationEvidence || item.confirmationChannel || "Sem evidência"}</div></td>
            <td><Badge v={item.status} /></td>
            <td><button className="btn" onClick={() => onDecide(item)}>Decidir</button></td>
          </tr>
        ))}
      </Table>
      {!queue.length && <div className="note">Nenhum ativo em revisão ou inelegível aguardando comitê.</div>}
    </div>
    <div className="card">
      <div className="ctitle">Ativos já aprovados para compra</div>
      <Table heads={["Ativo", "Cedente / Sacado", "Vencimento", "Valor", "Status"]}>
        {approved.map((item) => (
          <tr key={item.id}>
            <td className="mono">{item.id}</td>
            <td><div className="entity">{item.ced}</div><div className="sub">{item.sac}</div></td>
            <td>{item.venc}</td>
            <td className="mono">{fmt(item.valor)}</td>
            <td><Badge v={item.status} /></td>
          </tr>
        ))}
      </Table>
    </div>
  </>;
}

function PurchasePage({
  annualRate,
  assignors,
  cashAccounts,
  debtors,
  documentChecklists,
  fundingIssues,
  onNotice,
  receivables,
  purchase,
  owned,
  serviceFeeBps,
  setAnnualRate,
  setServiceFeeBps,
}: {
  annualRate: number;
  assignors: Assignor[];
  cashAccounts: CashAccount[];
  debtors: Debtor[];
  documentChecklists: DocumentChecklist[];
  fundingIssues: FundingIssue[];
  onNotice: (message: string) => void;
  receivables: Receivable[];
  purchase: (id: string) => Promise<void> | void;
  owned: Receivable[];
  serviceFeeBps: number;
  setAnnualRate: (value: number) => void;
  setServiceFeeBps: (value: number) => void;
}) {
  const purchasable = receivables.filter((d) => d.status === "Elegível" || d.status === "Aprovado" || d.status === "Comprado");
  const previews = purchasable.map((item) => {
    const pricing = item.pricing?.pricingSteps?.length ? item.pricing : priceReceivable(item, annualRate / 100, serviceFeeBps);
    return {
      item,
      pricing,
      readiness: buildPurchaseReadiness(item, pricing, assignors, debtors, documentChecklists, cashAccounts),
      owned: owned.some((ownedItem) => ownedItem.id === item.id),
    };
  });
  const face = previews.reduce((sum, row) => sum + row.item.valor, 0);
  const purchaseValue = previews.reduce((sum, row) => sum + (row.owned ? row.item.preco ?? row.pricing.purchasePrice : row.pricing.purchasePrice), 0);
  const weightedDiscount = face ? 1 - purchaseValue / face : 0;
  const readyRows = previews.filter((row) => !row.owned && row.readiness.status === "Pronto");
  const pendingRows = previews.filter((row) => !row.owned && row.readiness.status === "Pendente");
  const overrideRows = previews.filter((row) => !row.owned && row.readiness.status === "Override requerido");
  const openRows = previews.filter((row) => !row.owned);
  const readyValue = readyRows.reduce((sum, row) => sum + row.pricing.purchasePrice, 0);
  const readyFace = readyRows.reduce((sum, row) => sum + row.item.valor, 0);
  const readyDiscount = readyFace ? 1 - readyValue / readyFace : 0;
  const readyWeightedRate = readyFace ? readyRows.reduce((sum, row) => sum + row.pricing.annualRate * row.item.valor, 0) / readyFace : 0;
  const readyWeightedSpread = readyFace ? readyRows.reduce((sum, row) => sum + row.pricing.riskSpread * row.item.valor, 0) / readyFace : 0;
  const openFace = openRows.reduce((sum, row) => sum + row.item.valor, 0);
  const blockedValue = [...pendingRows, ...overrideRows].reduce((sum, row) => sum + row.item.valor, 0);
  const lotCount = new Set(openRows.map((row) => row.item.batchId).filter(Boolean)).size;
  const currentPortfolioFace = owned.reduce((sum, item) => sum + (item.outstandingValue ?? item.valor), 0);
  const proFormaPortfolioFace = currentPortfolioFace + readyFace;
  const purchaseCashAccount = cashAccounts.find((account) => account.purpose === "PURCHASE_SETTLEMENT" && account.status === "Ativa" && !account.deletedAt);
  const projectedPurchaseCash = (purchaseCashAccount?.balance ?? 0) - readyValue;
  const coverageAfterPurchase = readyValue ? (purchaseCashAccount?.balance ?? 0) / readyValue : 0;
  const concentrationRows = [...owned.map((item) => ({ ced: item.ced, sac: item.sac, value: item.outstandingValue ?? item.valor })), ...readyRows.map((row) => ({ ced: row.item.ced, sac: row.item.sac, value: row.item.valor }))];
  const topAssignorConcentration = Object.entries(concentrationRows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.ced]: (acc[row.ced] ?? 0) + row.value }), {}))
    .map(([name, value]) => ({ name, value, pct: proFormaPortfolioFace ? value / proFormaPortfolioFace : 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
  const topDebtorConcentration = Object.entries(concentrationRows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.sac]: (acc[row.sac] ?? 0) + row.value }), {}))
    .map(([name, value]) => ({ name, value, pct: proFormaPortfolioFace ? value / proFormaPortfolioFace : 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
  const proFormaAlerts = [
    ...(purchaseCashAccount && projectedPurchaseCash < 0 ? ["Saldo da conta de compra ficaria negativo."] : []),
    ...(topAssignorConcentration[0]?.pct > 0.35 ? [`Concentração cedente acima de 35%: ${topAssignorConcentration[0].name}.`] : []),
    ...(topDebtorConcentration[0]?.pct > 0.25 ? [`Concentração sacado acima de 25%: ${topDebtorConcentration[0].name}.`] : []),
    ...(!purchaseCashAccount ? ["Conta de liquidação de compra não configurada."] : []),
  ];
  const issuedFunding = fundingIssues.filter((issue) => issue.status === "Emitido");
  const totalFunding = issuedFunding.reduce((sum, issue) => sum + issue.amount, 0);
  const fundingWeightedCost = totalFunding ? issuedFunding.reduce((sum, issue) => sum + estimateFundingCost(issue.rate) * issue.amount, 0) / totalFunding : 0.12;
  const fundingAvailableAfterPurchase = totalFunding - proFormaPortfolioFace;
  const fundingUtilization = totalFunding ? proFormaPortfolioFace / totalFunding : 0;
  const estimatedNetMargin = readyWeightedRate - fundingWeightedCost;
  const fundingAlerts = [
    ...(totalFunding <= 0 ? ["Nenhum funding emitido cadastrado."] : []),
    ...(fundingAvailableAfterPurchase < 0 ? ["Cesta excede o funding emitido disponível."] : []),
    ...(estimatedNetMargin < 0.02 && readyRows.length ? ["Margem estimada abaixo de 2,00% a.a."] : []),
  ];
  const [bulkBuying, setBulkBuying] = useState(false);
  const [ticketCopied, setTicketCopied] = useState(false);
  const [savingTicket, setSavingTicket] = useState(false);
  const [savedTicketCode, setSavedTicketCode] = useState<string | null>(null);
  const [savedTicketStatus, setSavedTicketStatus] = useState<string | null>(null);

  const basketTicket = [
    "HOAM Warehouse · Boleta operacional de compra",
    `Data: ${new Date().toLocaleString("pt-BR")}`,
    `Parâmetros: taxa base ${annualRate.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% a.a. · custos ${serviceFeeBps} bps`,
    `Ativos prontos: ${readyRows.length}`,
    `Face pronta: ${fmt(readyFace)}`,
    `Preço líquido estimado: ${fmt(readyValue)}`,
    `Deságio médio: ${fmtPct(readyDiscount)}`,
    `Taxa efetiva média: ${fmtPct(readyWeightedRate)}`,
    `Spread médio: ${fmtPct(readyWeightedSpread)}`,
    `Bloqueado por pendências: ${fmt(blockedValue)} (${pendingRows.length + overrideRows.length} ativo(s))`,
    "",
    "Ativos prontos:",
    ...(readyRows.length
      ? readyRows.map((row) => `- ${row.item.id} · ${row.item.ced} / ${row.item.sac} · face ${fmt(row.item.valor)} · preço ${fmt(row.pricing.purchasePrice)} · taxa ${fmtPct(row.pricing.annualRate)} · venc. ${row.item.venc}`)
      : ["- Nenhum ativo pronto"]),
    "",
    "Pendências:",
    ...([...pendingRows, ...overrideRows].length
      ? [...pendingRows, ...overrideRows].map((row) => `- ${row.item.id} · ${row.readiness.blockers.map((blocker) => blocker.label).join(", ")}`)
      : ["- Sem pendências críticas na cesta pronta"]),
  ].join("\n");

  async function copyBasketTicket() {
    await navigator.clipboard.writeText(basketTicket);
    setTicketCopied(true);
    window.setTimeout(() => setTicketCopied(false), 2200);
  }

  async function saveBasketTicket() {
    if (!readyRows.length || savingTicket) return;
    setSavingTicket(true);
    try {
      const response = await fetch("/api/purchase-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketText: basketTicket,
          faceValue: readyFace,
          purchaseValue: readyValue,
          discountPercent: readyDiscount,
          effectiveRate: readyWeightedRate,
          riskSpread: readyWeightedSpread,
          baseAnnualRate: annualRate / 100,
          serviceFeeBps,
          readyCount: readyRows.length,
          blockedCount: pendingRows.length + overrideRows.length,
          snapshot: {
            openFace,
            blockedValue,
            lotCount,
            currentPortfolioFace,
            proFormaPortfolioFace,
            projectedPurchaseCash,
            proFormaAlerts,
          },
          items: readyRows.map((row) => ({
            externalId: row.item.id,
            assignorName: row.item.ced,
            debtorName: row.item.sac,
            dueDate: row.item.venc,
            faceValue: row.item.valor,
            purchasePrice: row.pricing.purchasePrice,
            effectiveRate: row.pricing.annualRate,
            riskSpread: row.pricing.riskSpread,
            status: row.readiness.status,
            readinessSnapshot: row.readiness,
            pricingSnapshot: row.pricing,
          })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Não foi possível salvar a boleta.");
      setSavedTicketCode(String(payload.id ?? payload.code ?? ""));
      setSavedTicketStatus(String(payload.status ?? "Rascunho"));
      onNotice(`Boleta ${payload.id ?? payload.code} salva como rascunho.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Não foi possível salvar a boleta.");
    } finally {
      setSavingTicket(false);
    }
  }

  async function updateBasketTicket(action: "submit" | "approve" | "reject" | "cancel") {
    if (!savedTicketCode) return;
    try {
      const response = await fetch("/api/purchase-tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: savedTicketCode,
          action,
          notes: action === "reject" ? "Reprovada pela mesa para ajustes." : "",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Não foi possível atualizar a boleta.");
      setSavedTicketStatus(String(payload.status));
      onNotice(`Boleta ${payload.id} atualizada para ${payload.status}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Não foi possível atualizar a boleta.");
    }
  }

  async function purchaseReadyBasket() {
    if (!readyRows.length || bulkBuying) return;
    if (savedTicketStatus !== "Aprovada") {
      onNotice("A compra da cesta exige boleta salva e aprovada.");
      return;
    }
    setBulkBuying(true);
    try {
      const response = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receivableIds: readyRows.map((row) => row.item.id),
          ticketId: savedTicketCode,
          annualRate: annualRate / 100,
          serviceFeeBps,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Não foi possível comprar a cesta.");
      const updatedReceivables = (payload?.receivables ?? []) as Receivable[];
      setSavedTicketStatus("Comprada");
      onNotice(`Compra agrupada ${payload.purchaseCode} concluída com ${updatedReceivables.length} ativo(s).`);
      window.location.reload();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Não foi possível comprar a cesta.");
    } finally {
      setBulkBuying(false);
    }
  }

  return (
    <>
      <div className="kpis">
        <K label="Prontos para compra" v={String(readyRows.length)} />
        <K label="Pendentes operacionais" v={String(pendingRows.length)} />
        <K label="Override requerido" v={String(overrideRows.length)} />
        <K label="Valor pronto" v={fmt(readyValue)} />
      </div>
      <div className="pricing-panel">
        <div>
          <div className="ctitle">Parâmetros de aquisição</div>
          <p className="muted">Apreçamento por valor presente com taxa base, spread de risco, custos e dias úteis estimados.</p>
        </div>
        <label>
          Taxa anual alvo
          <input
            type="number"
            step="0.1"
            min="0"
            value={annualRate}
            onChange={(e) => setAnnualRate(Number(e.target.value))}
          />
        </label>
        <label>
          Tarifa / custos (bps)
          <input
            type="number"
            step="1"
            min="0"
            value={serviceFeeBps}
            onChange={(e) => setServiceFeeBps(Number(e.target.value))}
          />
        </label>
        <div className="pricing-summary">
          <span>Preço estimado</span>
          <b>{fmt(purchaseValue)}</b>
          <small>Deságio médio {fmtPct(weightedDiscount)}</small>
        </div>
      </div>
      <div className="basket-simulation card">
        <div>
          <div className="ctitle">Simulação de compra da cesta</div>
          <p className="muted">
            Consolidação dos ativos disponíveis para aquisição. A compra em lote executa somente os ativos prontos, mantendo pendências bloqueadas.
          </p>
        </div>
        <div className="basket-grid">
          <div><span>Face disponível</span><b>{fmt(openFace)}</b><small>{openRows.length} ativo(s) · {lotCount || 1} lote(s)</small></div>
          <div><span>Face pronta</span><b>{fmt(readyFace)}</b><small>{readyRows.length} ativo(s) liberado(s)</small></div>
          <div><span>Preço líquido pronto</span><b>{fmt(readyValue)}</b><small>Deságio médio {fmtPct(readyDiscount)}</small></div>
          <div><span>Taxa média efetiva</span><b>{fmtPct(readyWeightedRate)}</b><small>Spread médio {fmtPct(readyWeightedSpread)}</small></div>
          <div><span>Bloqueado por pendências</span><b>{fmt(blockedValue)}</b><small>{pendingRows.length + overrideRows.length} ativo(s) fora da compra</small></div>
        </div>
        <div className="basket-actions">
          <button className="btn gold" disabled={!readyRows.length || bulkBuying} onClick={purchaseReadyBasket}>
            {bulkBuying ? "Comprando cesta..." : savedTicketStatus === "Aprovada" ? `Comprar ${readyRows.length} ativo(s) pronto(s)` : "Aprovação necessária"}
          </button>
          <span>{readyRows.length ? "Cada ativo mantém seu audit log e snapshot de apreçamento." : "Nenhum ativo pronto para compra no momento."}</span>
        </div>
        <div className="purchase-ticket">
          <div>
            <span>Boleta operacional</span>
            <b>{savedTicketCode ? `Boleta ${savedTicketCode}` : `Cesta pronta · ${readyRows.length} ativo(s)`}</b>
            <small>{fmt(readyFace)} face · {fmt(readyValue)} preço líquido · {fmtPct(readyWeightedRate)} taxa média</small>
            {savedTicketStatus && <div className="ticket-status"><Badge v={savedTicketStatus} /></div>}
          </div>
          <div className="ticket-actions">
            <button className="btn" disabled={!openRows.length} onClick={copyBasketTicket}>
              {ticketCopied ? "Boleta copiada" : "Copiar boleta"}
            </button>
            <button className="btn gold" disabled={!readyRows.length || savingTicket} onClick={saveBasketTicket}>
              {savingTicket ? "Salvando..." : savedTicketCode ? "Salvar nova versão" : "Salvar boleta"}
            </button>
            <button className="btn" disabled={!savedTicketCode || savedTicketStatus !== "Rascunho"} onClick={() => updateBasketTicket("submit")}>
              Enviar aprovação
            </button>
            <button className="btn gold" disabled={!savedTicketCode || savedTicketStatus !== "Em aprovação"} onClick={() => updateBasketTicket("approve")}>
              Aprovar
            </button>
            <button className="btn danger-btn" disabled={!savedTicketCode || savedTicketStatus !== "Em aprovação"} onClick={() => updateBasketTicket("reject")}>
              Reprovar
            </button>
          </div>
          <details>
            <summary>Prévia da boleta</summary>
            <pre>{basketTicket}</pre>
          </details>
        </div>
        <div className="proforma-panel">
          <div className="proforma-head">
            <div>
              <span>Impacto pós-compra</span>
              <b>Carteira e caixa pro forma</b>
              <small>Considera a aquisição integral dos ativos prontos da cesta.</small>
            </div>
            <Badge v={proFormaAlerts.length ? "Atenção" : "Dentro da política"} />
          </div>
          <div className="proforma-grid">
            <div><span>Carteira atual</span><b>{fmt(currentPortfolioFace)}</b><small>Saldo em aberto antes da compra</small></div>
            <div><span>Carteira pro forma</span><b>{fmt(proFormaPortfolioFace)}</b><small>+ {fmt(readyFace)} de face pronta</small></div>
            <div><span>Saída de caixa estimada</span><b>{fmt(readyValue)}</b><small>{purchaseCashAccount?.name ?? "Conta não configurada"}</small></div>
            <div><span>Saldo após compra</span><b>{fmt(projectedPurchaseCash)}</b><small>Cobertura {fmtPct(coverageAfterPurchase)}</small></div>
          </div>
          <div className="concentration-grid">
            <div>
              <span>Top cedentes pro forma</span>
              {topAssignorConcentration.map((row) => <small key={row.name}>{row.name} · {fmt(row.value)} · {fmtPct(row.pct)}</small>)}
              {!topAssignorConcentration.length && <small>Sem exposição pro forma.</small>}
            </div>
            <div>
              <span>Top sacados pro forma</span>
              {topDebtorConcentration.map((row) => <small key={row.name}>{row.name} · {fmt(row.value)} · {fmtPct(row.pct)}</small>)}
              {!topDebtorConcentration.length && <small>Sem exposição pro forma.</small>}
            </div>
            <div>
              <span>Alertas da simulação</span>
              {(proFormaAlerts.length ? proFormaAlerts : ["Sem alertas críticos para a cesta pronta."]).map((alert) => <small key={alert}>{alert}</small>)}
            </div>
          </div>
        </div>
        <div className="funding-cost-panel">
          <div className="proforma-head">
            <div>
              <span>Funding e custo de capital</span>
              <b>Margem estimada da cesta</b>
              <small>Estimativa baseada nas emissões com status Emitido. CDI assumido em 10,50% a.a. para taxas “CDI + spread”.</small>
            </div>
            <Badge v={fundingAlerts.length ? "Atenção" : "Dentro da política"} />
          </div>
          <div className="proforma-grid">
            <div><span>Funding emitido</span><b>{fmt(totalFunding)}</b><small>{issuedFunding.length} linha(s) ativa(s)</small></div>
            <div><span>Custo médio estimado</span><b>{fmtPct(fundingWeightedCost)}</b><small>Base ponderada por valor</small></div>
            <div><span>Margem da cesta</span><b>{fmtPct(estimatedNetMargin)}</b><small>Taxa média - custo funding</small></div>
            <div><span>Capacidade pós-compra</span><b>{fmt(fundingAvailableAfterPurchase)}</b><small>Utilização {fmtPct(fundingUtilization)}</small></div>
          </div>
          <div className="concentration-grid single">
            <div>
              <span>Alertas de funding</span>
              {(fundingAlerts.length ? fundingAlerts : ["Funding suficiente para a simulação atual."]).map((alert) => <small key={alert}>{alert}</small>)}
            </div>
          </div>
        </div>
      </div>
      <div className="card">
        <Table heads={["Ativo", "Cedente / Sacado", "Face", "Taxa / risco", "Preço", "Deságio", "Checklist", "Política", "Status", "Ação"]}>
          {previews.map(({ item, pricing, readiness, owned }) => {
            const blockers = readiness.blockers.slice(0, 3);
            const disabled = owned || readiness.blockers.length > 0;
            return (
              <tr key={item.id}>
                <td className="mono">{item.id}</td>
                <td><div className="entity">{item.ced}</div><div className="sub">{item.sac} · venc. {item.venc}</div></td>
                <td>{fmt(item.valor)}</td>
                <td>
                  <div className="entity">{fmtPct(pricing.annualRate)}</div>
                  <div className="sub">Base {fmtPct(pricing.baseAnnualRate)} · spread {fmtPct(pricing.riskSpread)} · {pricing.businessDays} DU</div>
                  <div className="sub">{pricing.riskAdjustments.map((adjustment) => `${adjustment.label} ${fmtPct(adjustment.rate)}`).join(" · ") || "Sem ajustes adicionais"}</div>
                </td>
                <td>
                  <div className="entity">{fmt(item.preco ?? pricing.purchasePrice)}</div>
                  <div className="sub">Bruto {fmt(pricing.grossPurchasePrice)} · fee {fmt(pricing.serviceFee)}</div>
                  <details className="pricing-memory">
                    <summary>Memória de cálculo</summary>
                    <div className="pricing-steps">
                      {pricing.pricingSteps.map((step) => (
                        <div className="pricing-step" key={step.label}>
                          <span>{step.label}</span>
                          <b>{formatPricingStepValue(step)}</b>
                          <small>{step.formula}</small>
                          {step.detail && <em>{step.detail}</em>}
                        </div>
                      ))}
                    </div>
                  </details>
                </td>
                <td><div className="entity">{fmt(pricing.discount)}</div><div className="sub">{fmtPct(pricing.discountPercent)}</div></td>
                <td>
                  <Badge v={readiness.status} />
                  <div className="sub">{readiness.blockers.length ? `${readiness.blockers.length} pendência(s)` : "Todos os controles críticos OK"}</div>
                  {blockers.map((check) => <div className="sub" key={check.label}>• {check.label}</div>)}
                </td>
                <td>{pricing.policyWarnings.length ? <Badge v="Atenção" /> : <Badge v="Dentro da política" />}<div className="sub">{pricing.policyWarnings[0] ?? "Preço líquido válido"}</div></td>
                <td><Badge v={owned ? "Comprado" : item.status} /></td>
                <td><button disabled={disabled} className="btn" onClick={() => purchase(item.id)}>{owned ? "Adquirido" : readiness.blockers.length ? "Pendências" : item.status === "Aprovado" ? "Comprar exceção" : "Comprar"}</button></td>
              </tr>
            );
          })}
        </Table>
        {!previews.length && <div className="note">Nenhum ativo elegível ou aprovado disponível para compra.</div>}
      </div>
    </>
  );
}

function PortfolioPage({ owned, softDelete, canDelete }: { receivables: Receivable[]; owned: Receivable[]; softDelete: (id: string) => void; canDelete: boolean }) {
  const face = owned.reduce((a, d) => a + d.valor, 0);
  const purchaseValue = owned.reduce((a, d) => a + (d.preco ?? priceReceivable(d).purchasePrice), 0);
  const averagePrice = face ? purchaseValue / face : 0;
  return <>
    <div className="kpis"><K label="Valor de face" v={fmt(face)} /><K label="Valor de aquisição" v={fmt(purchaseValue)} /><K label="Preço médio" v={fmtPct(averagePrice)} /><K label="Ativos em carteira" v={String(owned.length)} /></div>
    <div className="card"><Table heads={["Ativo", "Cedente / Sacado", "Vencimento", "Face", "Aquisição", "Saldo", "Status", "Governança"]}>{owned.map((d) => <tr key={d.id}><td className="mono">{d.id}</td><td><div className="entity">{d.ced}</div><div className="sub">{d.sac}</div></td><td>{d.venc}</td><td>{fmt(d.valor)}</td><td>{fmt(d.acquisitionValue ?? d.preco ?? priceReceivable(d).purchasePrice)}</td><td>{fmt(d.outstandingValue ?? d.valor)}</td><td><Badge v={d.portfolioStatus ?? d.status} /></td><td>{canDelete ? <button className="btn" onClick={() => softDelete(d.id)}><Trash2 size={13} /> Soft delete</button> : "Protegido"}</td></tr>)}</Table></div>
  </>;
}

function daysFromToday(value: string) {
  if (value.includes("-")) {
    const dueIso = new Date(value);
    if (!Number.isNaN(dueIso.getTime())) {
      const today = new Date();
      const base = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
      const due = new Date(Date.UTC(dueIso.getFullYear(), dueIso.getMonth(), dueIso.getDate()));
      return Math.ceil((due.getTime() - base.getTime()) / 86_400_000);
    }
  }
  const [day, month, year] = value.split("/").map(Number);
  const due = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  const today = new Date();
  const base = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  return Math.ceil((due.getTime() - base.getTime()) / 86_400_000);
}

function collectionStage(item: Receivable) {
  const outstanding = item.outstandingValue ?? item.valor;
  const aging = daysFromToday(item.venc);
  const collected = Math.max(0, item.valor - outstanding);
  if (item.status === "Liquidado" || (item.portfolioStatus ?? "") === "Liquidado" || outstanding <= 0) {
    return { stage: "Liquidado", priority: "Baixa", next: "Conferir caixa e arquivar evidência", sla: "D+0" };
  }
  if ((item.portfolioStatus ?? "").includes("Renegociado")) {
    return { stage: "Renegociado", priority: "Média", next: "Acompanhar novo compromisso", sla: "D+1" };
  }
  if (aging < -10) return { stage: "Cobrança crítica", priority: "Crítica", next: "Escalar para jurídico/comitê", sla: "Hoje" };
  if (aging < 0) return { stage: "Vencido", priority: "Alta", next: "Acionar sacado e registrar evidência", sla: "Hoje" };
  if (aging <= 2) return { stage: "D-2 a D0", priority: "Alta", next: "Confirmar pagamento programado", sla: "Hoje" };
  if (aging <= 7) return { stage: "Pré-vencimento", priority: "Média", next: "Enviar lembrete de vencimento", sla: "D+1" };
  if (collected > 0) return { stage: "Liquidação parcial", priority: "Média", next: "Cobrar saldo remanescente", sla: "D+1" };
  return { stage: "A vencer", priority: "Baixa", next: "Monitorar agenda", sla: "D+3" };
}

function collectionHistory(item: Receivable) {
  const outstanding = item.outstandingValue ?? item.valor;
  const events = [
    { label: "Compra registrada", detail: `Entrada em carteira · aquisição ${fmt(item.acquisitionValue ?? item.preco ?? priceReceivable(item).purchasePrice)}` },
  ];
  if (item.confirmationStatus) events.push({ label: "Confirmação", detail: `${item.confirmationStatus} · ${item.confirmationChannel ?? "canal não informado"}` });
  if (outstanding < item.valor && outstanding > 0) events.push({ label: "Recebimento parcial", detail: `Recebido ${fmt(item.valor - outstanding)} · saldo ${fmt(outstanding)}` });
  if (item.status === "Vencido" || (item.portfolioStatus ?? "").includes("cobrança")) events.push({ label: "Cobrança", detail: item.portfolioStatus ?? "Ativo vencido" });
  if ((item.portfolioStatus ?? "").includes("Renegociado")) events.push({ label: "Renegociação", detail: "Compromisso renegociado registrado" });
  if (item.status === "Liquidado" || (item.portfolioStatus ?? "") === "Liquidado" || outstanding <= 0) events.push({ label: "Liquidação", detail: "Saldo baixado da carteira" });
  return events;
}

function SettlementPage({ receivables, onSettle }: { receivables: Receivable[]; onSettle: (item: Receivable) => void }) {
  const open = receivables.filter((item) => item.status !== "Liquidado" && (item.outstandingValue ?? item.valor) > 0);
  const settled = receivables.filter((item) => item.status === "Liquidado" || (item.portfolioStatus ?? "") === "Liquidado");
  const overdue = open.filter((item) => item.status === "Vencido" || daysFromToday(item.venc) < 0);
  const outstanding = open.reduce((sum, item) => sum + (item.outstandingValue ?? item.valor), 0);
  const collected = receivables.reduce((sum, item) => sum + Math.max(0, item.valor - (item.outstandingValue ?? item.valor)), 0);
  const collectionRows = receivables.map((item) => ({ item, stage: collectionStage(item), history: collectionHistory(item) }));
  const critical = collectionRows.filter((row) => ["Crítica", "Alta"].includes(row.stage.priority)).length;
  return <>
    <div className="kpis">
      <K label="Saldo em aberto" v={fmt(outstanding)} />
      <K label="Recebido acumulado" v={fmt(collected)} />
      <K label="Ativos vencidos" v={String(overdue.length)} />
      <K label="Prioridade alta/crítica" v={String(critical)} />
    </div>
    <div className="grid">
      <div className="card">
        <div className="ctitle">Régua de cobrança</div>
        <Table heads={["Ativo", "Cedente / Sacado", "Vencimento", "Saldo", "Aging", "Etapa", "Prioridade", "Próxima ação", "Ação"]}>
          {collectionRows.map(({ item, stage }) => {
            const outstandingValue = item.outstandingValue ?? item.valor;
            const aging = daysFromToday(item.venc);
            const status = item.portfolioStatus ?? item.status;
            const disabled = item.status === "Liquidado" || status === "Liquidado" || outstandingValue <= 0;
            return (
              <tr key={item.id}>
                <td className="mono">{item.id}</td>
                <td><div className="entity">{item.ced}</div><div className="sub">{item.sac}</div></td>
                <td>{item.venc}</td>
                <td className="mono">{fmt(outstandingValue)}</td>
                <td>{aging < 0 ? `${Math.abs(aging)} dia(s) vencido` : `${aging} dia(s)`}</td>
                <td><Badge v={stage.stage} /><div className="sub">{status}</div></td>
                <td><Badge v={stage.priority} /><div className="sub">SLA {stage.sla}</div></td>
                <td>{stage.next}</td>
                <td><button className="btn" disabled={disabled} onClick={() => onSettle(item)}>{disabled ? "Encerrado" : "Registrar"}</button></td>
              </tr>
            );
          })}
        </Table>
        {!receivables.length && <div className="note">Nenhum ativo adquirido em carteira para cobrança.</div>}
      </div>
      <div className="card">
        <div className="ctitle">Resumo da carteira</div>
        <div className="collection-grid">
          <div><span>Liquidados</span><b>{settled.length}</b><small>{fmt(collected)} recebido</small></div>
          <div><span>Vencidos</span><b>{overdue.length}</b><small>{fmt(overdue.reduce((sum, item) => sum + (item.outstandingValue ?? item.valor), 0))}</small></div>
          <div><span>Aberto</span><b>{open.length}</b><small>{fmt(outstanding)}</small></div>
        </div>
        <div className="ctitle space-top">Política operacional</div>
        {[
          "Recebimento parcial mantém o ativo em carteira com novo saldo em aberto.",
          "Recebimento total baixa o ativo como liquidado e gera entrada de caixa.",
          "Marcação de vencido leva o ativo para cobrança sem gerar caixa.",
          "Todo evento gera transição de workflow e audit log.",
        ].map((rule) => <div className="rule" key={rule}>{rule}<Check size={14} color="#70c69a" /></div>)}
      </div>
    </div>
    <div className="card">
      <div className="ctitle">Histórico operacional por ativo</div>
      <div className="collection-history-grid">
        {collectionRows.slice(0, 12).map(({ item, history }) => (
          <div className="collection-history" key={item.id}>
            <div className="pipe-card-top"><b className="mono">{item.id}</b><Badge v={item.portfolioStatus ?? item.status} /></div>
            <small>{item.ced} → {item.sac}</small>
            {history.map((event) => <p key={`${item.id}-${event.label}`}><span>{event.label}</span>{event.detail}</p>)}
          </div>
        ))}
      </div>
    </div>
  </>;
}

function RiskCovenantsPage({ assignors, debtors, fundingIssues, receivables }: { assignors: Assignor[]; debtors: Debtor[]; fundingIssues: FundingIssue[]; receivables: Receivable[] }) {
  const portfolio = receivables.filter((item) => item.portfolioStatus || ["Comprado", "Vencido", "Liquidado"].includes(item.status));
  const openPortfolio = portfolio.filter((item) => item.status !== "Liquidado");
  const exposure = openPortfolio.reduce((sum, item) => sum + (item.outstandingValue ?? item.valor), 0);
  const issuedFunding = fundingIssues.filter((item) => item.status === "Emitido").reduce((sum, item) => sum + item.amount, 0);
  const coverage = issuedFunding ? exposure / issuedFunding : 0;
  const overdue = openPortfolio.filter((item) => item.status === "Vencido" || daysFromToday(item.venc) < 0).reduce((sum, item) => sum + (item.outstandingValue ?? item.valor), 0);
  const topAssignor = topConcentration(openPortfolio, "ced");
  const topDebtor = topConcentration(openPortfolio, "sac");
  const alerts = [
    { label: "Cobertura de funding", value: fmtPct(coverage), status: coverage > 0.9 ? "Atenção" : "Dentro da política", rule: "Carteira / funding emitido ≤ 90%" },
    { label: "Maior cedente", value: fmtPct(topAssignor.ratio), status: topAssignor.ratio > 0.35 ? "Atenção" : "Dentro da política", rule: "Concentração por cedente ≤ 35%" },
    { label: "Maior sacado", value: fmtPct(topDebtor.ratio), status: topDebtor.ratio > 0.25 ? "Atenção" : "Dentro da política", rule: "Concentração por sacado ≤ 25%" },
    { label: "Vencidos", value: fmtPct(exposure ? overdue / exposure : 0), status: exposure && overdue / exposure > 0.03 ? "Atenção" : "Dentro da política", rule: "Vencidos / carteira ≤ 3%" },
  ];
  const assignorRows = concentrationRows(openPortfolio, "ced", assignors.map((item) => ({ name: item.nome, limit: item.limite })));
  const debtorRows = concentrationRows(openPortfolio, "sac", debtors.map((item) => ({ name: item.nome, limit: item.valor })));
  const sectorByAssignor = Object.fromEntries(assignors.map((item) => [item.nome, item.setor || "Sem setor"]));
  const ratingByDebtor = Object.fromEntries(debtors.map((item) => [item.nome, item.rating || "Sem rating"]));
  const sectorRows = categoryConcentrationRows(openPortfolio, (item) => sectorByAssignor[item.ced] ?? "Sem setor");
  const ratingRows = categoryConcentrationRows(openPortfolio, (item) => ratingByDebtor[item.sac] ?? item.debtorRating ?? "Sem rating");
  const tenorRows = categoryConcentrationRows(openPortfolio, (item) => {
    const days = daysFromToday(item.venc);
    if (days <= 30) return "0-30 dias";
    if (days <= 60) return "31-60 dias";
    if (days <= 90) return "61-90 dias";
    return "90+ dias";
  });
  const batchRows = categoryConcentrationRows(openPortfolio, (item) => item.batchId ?? "Sem lote");

  return <>
    <div className="kpis">
      <K label="Exposição em aberto" v={fmt(exposure)} />
      <K label="Funding emitido" v={fmt(issuedFunding)} />
      <K label="Uso do funding" v={fmtPct(coverage)} />
      <K label="Vencidos" v={fmt(overdue)} />
    </div>
    <div className="grid">
      <div className="card">
        <div className="ctitle">Covenants executivos</div>
        <Table heads={["Indicador", "Valor", "Regra", "Situação"]}>
          {alerts.map((alert) => (
            <tr key={alert.label}>
              <td>{alert.label}</td>
              <td className="mono">{alert.value}</td>
              <td>{alert.rule}</td>
              <td><Badge v={alert.status} /></td>
            </tr>
          ))}
        </Table>
      </div>
      <div className="card">
        <div className="ctitle">Leitura de risco</div>
        {[
          `Maior cedente: ${topAssignor.name || "sem carteira"} (${fmt(topAssignor.amount)})`,
          `Maior sacado: ${topDebtor.name || "sem carteira"} (${fmt(topDebtor.amount)})`,
          `Headroom de funding: ${fmt(Math.max(0, issuedFunding - exposure))}`,
          `Ativos em carteira monitorada: ${openPortfolio.length}`,
        ].map((rule) => <div className="rule" key={rule}>{rule}<Check size={14} color="#70c69a" /></div>)}
      </div>
    </div>
    <div className="grid">
      <div className="card">
        <div className="ctitle">Concentração por cedente</div>
        <Table heads={["Cedente", "Exposição", "% carteira", "Limite", "Uso"]}>
          {assignorRows.map((row) => <tr key={row.name}><td>{row.name}</td><td>{fmt(row.amount)}</td><td>{fmtPct(row.ratio)}</td><td>{fmt(row.limit)}</td><td><Badge v={row.limitUsage > 0.9 ? "Atenção" : "Dentro da política"} /></td></tr>)}
        </Table>
      </div>
      <div className="card">
        <div className="ctitle">Concentração por sacado</div>
        <Table heads={["Sacado", "Exposição", "% carteira", "Limite", "Uso"]}>
          {debtorRows.map((row) => <tr key={row.name}><td>{row.name}</td><td>{fmt(row.amount)}</td><td>{fmtPct(row.ratio)}</td><td>{fmt(row.limit)}</td><td><Badge v={row.limitUsage > 0.9 ? "Atenção" : "Dentro da política"} /></td></tr>)}
        </Table>
      </div>
    </div>
    <div className="grid">
      <div className="card">
        <div className="ctitle">Concentração por setor e rating</div>
        <Table heads={["Dimensão", "Exposição", "% carteira", "Limite referência", "Situação"]}>
          {sectorRows.slice(0, 5).map((row) => <tr key={`setor-${row.name}`}><td>Setor · {row.name}</td><td>{fmt(row.amount)}</td><td>{fmtPct(row.ratio)}</td><td>≤ 40%</td><td><Badge v={row.ratio > 0.4 ? "Atenção" : "Dentro da política"} /></td></tr>)}
          {ratingRows.slice(0, 5).map((row) => <tr key={`rating-${row.name}`}><td>Rating · {row.name}</td><td>{fmt(row.amount)}</td><td>{fmtPct(row.ratio)}</td><td>≤ 45%</td><td><Badge v={row.ratio > 0.45 ? "Atenção" : "Dentro da política"} /></td></tr>)}
        </Table>
      </div>
      <div className="card">
        <div className="ctitle">Concentração por prazo e lote</div>
        <Table heads={["Dimensão", "Exposição", "% carteira", "Limite referência", "Situação"]}>
          {tenorRows.map((row) => <tr key={`prazo-${row.name}`}><td>Prazo · {row.name}</td><td>{fmt(row.amount)}</td><td>{fmtPct(row.ratio)}</td><td>≤ 50%</td><td><Badge v={row.ratio > 0.5 ? "Atenção" : "Dentro da política"} /></td></tr>)}
          {batchRows.slice(0, 4).map((row) => <tr key={`lote-${row.name}`}><td>Lote · {row.name}</td><td>{fmt(row.amount)}</td><td>{fmtPct(row.ratio)}</td><td>≤ 30%</td><td><Badge v={row.ratio > 0.3 ? "Atenção" : "Dentro da política"} /></td></tr>)}
        </Table>
      </div>
    </div>
  </>;
}

function topConcentration(items: Receivable[], field: "ced" | "sac") {
  const total = items.reduce((sum, item) => sum + (item.outstandingValue ?? item.valor), 0);
  const rows = concentrationRows(items, field, []);
  const top = rows[0] ?? { name: "", amount: 0, ratio: 0 };
  return { ...top, ratio: total ? top.amount / total : 0 };
}

function concentrationRows(items: Receivable[], field: "ced" | "sac", limits: { name: string; limit: number }[]) {
  const total = items.reduce((sum, item) => sum + (item.outstandingValue ?? item.valor), 0);
  const map = new Map<string, number>();
  for (const item of items) map.set(item[field], (map.get(item[field]) ?? 0) + (item.outstandingValue ?? item.valor));
  return [...map.entries()]
    .map(([name, amount]) => {
      const limit = limits.find((item) => item.name === name)?.limit ?? 0;
      return { name, amount, ratio: total ? amount / total : 0, limit, limitUsage: limit ? amount / limit : 0 };
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);
}

function categoryConcentrationRows(items: Receivable[], selector: (item: Receivable) => string) {
  const total = items.reduce((sum, item) => sum + (item.outstandingValue ?? item.valor), 0);
  const map = new Map<string, number>();
  for (const item of items) {
    const name = selector(item);
    map.set(name, (map.get(name) ?? 0) + (item.outstandingValue ?? item.valor));
  }
  return [...map.entries()]
    .map(([name, amount]) => ({ name, amount, ratio: total ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

type ReconciliationSuggestion = {
  entry: BankStatementEntry;
  movement: CashMovement | null;
  score: number;
  amountDiff: number;
  reasons: string[];
};

function normalizeText(value?: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseBrDate(value: string) {
  const [day, month, year] = value.split("/").map(Number);
  if (!day || !month || !year) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateDistanceInDays(a: string, b: string) {
  const first = parseBrDate(a);
  const second = parseBrDate(b);
  if (!first || !second) return 999;
  return Math.abs(Math.round((first.getTime() - second.getTime()) / 86_400_000));
}

function sharedTokenScore(a?: string | null, b?: string | null) {
  const left = new Set(normalizeText(a).split(" ").filter((token) => token.length > 2));
  const right = new Set(normalizeText(b).split(" ").filter((token) => token.length > 2));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return Math.round((shared / Math.max(left.size, right.size)) * 100);
}

function buildReconciliationSuggestions(entries: BankStatementEntry[], movements: CashMovement[]): ReconciliationSuggestion[] {
  const reconciledMovementIds = new Set(entries.filter((entry) => entry.status === "Conciliado" && entry.cashMovementId).map((entry) => entry.cashMovementId));
  const availableMovements = movements.filter((movement) => !reconciledMovementIds.has(movement.id));
  return entries.map((entry) => {
    const candidates = availableMovements
      .filter((movement) => movement.accountId === entry.accountId && movement.type === entry.type)
      .map((movement) => {
        const amountDiff = Math.abs(movement.amount - entry.amount);
        const dayDiff = dateDistanceInDays(entry.date, movement.date);
        const referenceMatch = Boolean(entry.reference && movement.reference && normalizeText(entry.reference) === normalizeText(movement.reference));
        const textScore = sharedTokenScore(entry.description, movement.description);
        const exactAmount = amountDiff <= 0.01;
        const score = Math.min(100,
          35 +
          (exactAmount ? 35 : amountDiff / Math.max(entry.amount, 1) <= 0.01 ? 20 : 0) +
          (dayDiff === 0 ? 15 : dayDiff <= 2 ? 9 : dayDiff <= 5 ? 4 : 0) +
          (referenceMatch ? 10 : 0) +
          Math.min(5, Math.round(textScore / 20)),
        );
        const reasons = [
          "mesma conta",
          "mesmo tipo",
          exactAmount ? "valor exato" : `dif. ${fmt(amountDiff)}`,
          dayDiff === 0 ? "mesma data" : `${dayDiff} dia(s)`,
          referenceMatch ? "referência igual" : textScore >= 40 ? "descrição similar" : "",
        ].filter(Boolean);
        return { movement, amountDiff, score, reasons };
      })
      .sort((a, b) => b.score - a.score || a.amountDiff - b.amountDiff);
    const best = candidates[0];
    return {
      entry,
      movement: best?.movement ?? null,
      score: best?.score ?? 0,
      amountDiff: best?.amountDiff ?? 0,
      reasons: best?.reasons ?? [],
    };
  });
}

function CashPage({
  accounts,
  entries,
  movements,
  onAddAccount,
  onAddMovement,
  onAddStatement,
  onReconcile,
}: {
  accounts: CashAccount[];
  entries: BankStatementEntry[];
  movements: CashMovement[];
  onAddAccount: () => void;
  onAddMovement: () => void;
  onAddStatement: () => void;
  onReconcile: (entryId: string, action?: string, cashMovementId?: string) => void;
}) {
  const balance = accounts.reduce((sum, account) => sum + account.balance, 0);
  const inflows = movements.filter((item) => item.type === "Entrada").reduce((sum, item) => sum + item.amount, 0);
  const outflows = movements.filter((item) => item.type === "Saída").reduce((sum, item) => sum + item.amount, 0);
  const pending = entries.filter((item) => item.status === "Pendente").length;
  const reconciled = entries.filter((item) => item.status === "Conciliado").length;
  const divergent = entries.filter((item) => item.status === "Divergente").length;
  const suggestions = buildReconciliationSuggestions(entries, movements);
  const strongSuggestions = suggestions.filter((item) => item.score >= 80).length;
  const suggestedValue = suggestions.filter((item) => item.score >= 80).reduce((sum, item) => sum + item.entry.amount, 0);
  return <>
    <div className="kpis">
      <K label="Saldo consolidado" v={fmt(balance)} />
      <K label="Entradas" v={fmt(inflows)} />
      <K label="Saídas" v={fmt(outflows)} />
      <K label="Conciliação pendente" v={String(pending)} />
    </div>
    <div className="grid">
      <div className="card">
        <div className="ctitle">Contas operacionais <button className="mini" onClick={onAddAccount}>Nova conta</button></div>
        <Table heads={["Conta", "Banco", "Finalidade", "Tipo", "Saldo", "Status"]}>
          {accounts.map((account) => (
            <tr key={account.id}>
              <td><span className="mono">{account.id}</span><div className="sub">{account.name}</div></td>
              <td><div className="entity">{account.bankName || "Não informado"}</div><div className="sub">{account.branch || "-"} · {account.accountNumber || "-"}</div></td>
              <td>{cashPurposeLabel(account.purpose)}</td>
              <td>{account.accountType}</td>
              <td className="mono">{fmt(account.balance)}</td>
              <td><Badge v={account.status} /></td>
            </tr>
          ))}
        </Table>
      </div>
      <div className="card">
        <div className="ctitle">Política de tesouraria</div>
        {[
          "Compras devem liquidar pela conta de liquidação de compras.",
          "Recebimentos de sacados entram na conta de recebimentos.",
          "Reserva operacional deve receber transferências internas.",
          "Todo lançamento manual gera audit log.",
        ].map((rule) => <div className="rule" key={rule}>{rule}<Check size={14} color="#70c69a" /></div>)}
      </div>
    </div>
    <div className="card">
      <div className="ctitle">Conciliação bancária <button className="mini" onClick={onAddStatement}>Novo item de extrato</button></div>
      <div className="kpis mini-kpis">
        <K label="Extratos conciliados" v={String(reconciled)} />
        <K label="Extratos pendentes" v={String(pending)} />
        <K label="Divergências" v={String(divergent)} />
        <K label="Cobertura" v={`${Math.round((reconciled / Math.max(entries.length, 1)) * 100)}%`} />
      </div>
      <div className="reconciliation-strip">
        <div><span>Sugestões fortes</span><b>{strongSuggestions}</b><small>{fmt(suggestedValue)}</small></div>
        <div><span>Critério</span><b>Conta + tipo + valor</b><small>Refina por data, referência e descrição</small></div>
        <div><span>Uso recomendado</span><b>Pré-conciliar</b><small>Confirmar antes do fechamento diário</small></div>
      </div>
      <Table heads={["Extrato", "Data", "Conta", "Descrição", "Referência", "Tipo", "Valor", "Sugestão", "Status", "Ação"]}>
        {suggestions.map(({ entry, movement, amountDiff, score, reasons }) => (
          <tr key={entry.id}>
            <td className="mono">{entry.id}</td>
            <td>{entry.date}</td>
            <td>{entry.accountName || entry.accountId}</td>
            <td>{entry.description}<div className="sub">{entry.notes || ""}</div></td>
            <td className="mono">{entry.reference || "-"}</td>
            <td><Badge v={entry.type} /></td>
            <td className="mono">{fmt(entry.amount)}</td>
            <td>
              {movement ? (
                <div className="match-card">
                  <div><span className="mono">{movement.id}</span><Badge v={`${score}%`} /></div>
                  <small>{movement.description}</small>
                  <small>{reasons.join(" · ")}</small>
                  {amountDiff > 0 && <small>Diferença: {fmt(amountDiff)}</small>}
                </div>
              ) : <span className="sub">Sem candidato</span>}
            </td>
            <td><Badge v={entry.status} /></td>
            <td>
              {entry.status === "Pendente" ? (
                <div className="row-actions">
                  <button className="btn" disabled={!movement || score < 80 || amountDiff > 0.01} onClick={() => onReconcile(entry.id, "auto_match", movement?.id)}>Aceitar sugestão</button>
                  <button className="btn" onClick={() => onReconcile(entry.id)}>Auto</button>
                  <button className="btn danger-btn" onClick={() => onReconcile(entry.id, "mark_divergent")}>Divergência</button>
                </div>
              ) : entry.cashMovementId ? <span className="mono">{entry.cashMovementId}</span> : "Registrado"}
            </td>
          </tr>
        ))}
      </Table>
    </div>
    <div className="card">
      <div className="ctitle">Razão de caixa <button className="mini" onClick={onAddMovement}>Novo movimento</button></div>
      <Table heads={["Código", "Data", "Conta", "Descrição", "Referência", "Tipo", "Valor"]}>
        {movements.map((movement) => (
          <tr key={movement.id}>
            <td className="mono">{movement.id}</td>
            <td>{movement.date}</td>
            <td>{movement.accountName || movement.accountId || "Sem conta"}</td>
            <td>{movement.description}</td>
            <td className="mono">{movement.reference || "-"}</td>
            <td><Badge v={movement.type} /></td>
            <td className="mono">{fmt(movement.amount)}</td>
          </tr>
        ))}
      </Table>
    </div>
  </>;
}

function cashPurposeLabel(purpose: string) {
  const labels: Record<string, string> = {
    PURCHASE_SETTLEMENT: "Liquidação de compras",
    RECEIVABLE_COLLECTION: "Recebimento de sacados",
    RESERVE: "Reserva operacional",
    FUNDING: "Funding / emissão",
    OPERATING: "Operacional",
  };
  return labels[purpose] ?? purpose;
}

function FundingPage({ issues, portfolioValue, onAdd, onStatus }: { issues: FundingIssue[]; portfolioValue: number; onAdd: () => void; onStatus: (id: string, status: FundingIssue["status"]) => void }) {
  const committed = issues.filter((item) => item.status !== "Liquidado").reduce((sum, item) => sum + item.amount, 0);
  const issued = issues.filter((item) => item.status === "Emitido").reduce((sum, item) => sum + item.amount, 0);
  const available = Math.max(0, issued - portfolioValue);
  return <>
    <div className="kpis">
      <K label="Funding contratado" v={fmt(committed)} />
      <K label="Emitido" v={fmt(issued)} />
      <K label="Carteira financiada" v={fmt(portfolioValue)} />
      <K label="Capacidade disponível" v={fmt(available)} />
    </div>
    <div className="grid">
      <div className="card">
        <div className="ctitle">Linhas e emissões <button className="mini" onClick={onAdd}>Nova emissão</button></div>
        <Table heads={["Código", "Instrumento", "Valor", "Taxa", "Vencimento", "Status", "Ação"]}>
          {issues.map((issue) => (
            <tr key={issue.id}>
              <td className="mono">{issue.id}</td>
              <td>{issue.instrument}</td>
              <td className="mono">{fmt(issue.amount)}</td>
              <td>{issue.rate}</td>
              <td>{issue.maturity}</td>
              <td><Badge v={issue.status} /></td>
              <td>
                <div className="row-actions">
                  <button className="btn" disabled={issue.status === "Emitido"} onClick={() => onStatus(issue.id, "Emitido")}>Emitir</button>
                  <button className="btn" disabled={issue.status === "Liquidado"} onClick={() => onStatus(issue.id, "Liquidado")}>Liquidar</button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </div>
      <div className="card">
        <div className="ctitle">Governança de funding</div>
        {[
          "Funding emitido compõe a capacidade disponível para aquisição.",
          "Emissões liquidadas saem da capacidade ativa.",
          "Taxas e vencimentos ficam registrados para análise de custo de capital.",
          "Mudanças de status são auditadas.",
        ].map((rule) => <div className="rule" key={rule}>{rule}<Check size={14} color="#70c69a" /></div>)}
      </div>
    </div>
  </>;
}

function DocumentsPage({ checklists, documents, canCreate, onAdd, onNotice }: { checklists: DocumentChecklist[]; documents: DocumentRecord[]; canCreate: boolean; onAdd: () => void; onNotice: (message: string) => void }) {
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const pending = checklists.filter((item) => !item.ok);
  const valid = documents.filter((d) => d.status === "Válido").length;
  const expired = documents.filter((d) => d.status === "Vencido").length;
  const review = documents.filter((d) => d.status === "Em revisão" || d.status === "Pendente").length;
  const documentHealth = documents.map((doc) => {
    const days = doc.expiresAt ? daysFromToday(doc.expiresAt) : null;
    const hasBinary = doc.size !== "Metadado" && doc.size !== "0 MB";
    const missingGovernance = !doc.stage || !doc.requirement;
    const status =
      doc.status === "Vencido" || (days !== null && days < 0) ? "Vencido" :
      days !== null && days <= 30 ? "Vence em breve" :
      doc.status === "Pendente" || doc.status === "Em revisão" ? "Em revisão" :
      missingGovernance ? "Classificar" :
      !hasBinary ? "Sem arquivo" :
      "Válido";
    const severity = status === "Vencido" ? "Crítico" : status === "Vence em breve" || status === "Sem arquivo" ? "Alto" : status === "Em revisão" || status === "Classificar" ? "Médio" : "Baixo";
    const impact = doc.requirement === "KYC_CEDENTE" || doc.requirement === "PROCURACAO" || doc.requirement === "CONTRATO_CESSAO"
      ? "Bloqueia cadastro/compra"
      : doc.requirement === "COMPROVANTE_LASTRO" || doc.requirement === "EVIDENCIA_CONFIRMACAO" || doc.requirement === "COMPROVANTE_PAGAMENTO"
        ? "Bloqueia ou condiciona compra"
        : "Governança / auditoria";
    return { doc, days, hasBinary, missingGovernance, status, severity, impact };
  });
  const expiringSoon = documentHealth.filter((item) => item.status === "Vence em breve").length;
  const withoutFile = documentHealth.filter((item) => item.status === "Sem arquivo").length;
  const classified = documents.filter((doc) => doc.stage && doc.requirement).length;
  const completion = Math.round((checklists.filter((item) => item.ok).length / Math.max(checklists.length, 1)) * 100);
  const dossiers = checklists.map((item) => {
    const linkedDocs = documents.filter((doc) => doc.entity === item.receivableId || doc.entity.includes(item.receivableId));
    return { ...item, linkedDocs, completion: Math.round(((item.required.length - item.gaps.length) / Math.max(item.required.length, 1)) * 100) };
  });
  const byStage = documents.reduce<Record<string, number>>((acc, doc) => {
    const key = doc.stage || "Sem etapa";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const stageRequirements = [
    { stage: "Cadastro", requirement: "KYC_CEDENTE", label: "KYC do cedente", type: "KYC" },
    { stage: "Cadastro", requirement: "PROCURACAO", label: "Procuração / poderes", type: "Procuração" },
    { stage: "Cadastro", requirement: "CONTRATO_CESSAO", label: "Contrato de cessão", type: "Contrato" },
    { stage: "Importação", requirement: "BORDERO_IMPORTACAO", label: "Borderô de importação", type: "Borderô" },
    { stage: "Importação", requirement: "COMPROVANTE_LASTRO", label: "Comprovante de lastro", type: "Lastro" },
    { stage: "Confirmação", requirement: "EVIDENCIA_CONFIRMACAO", label: "Evidência de confirmação", type: "Comprovante" },
    { stage: "Comitê", requirement: "ATA_COMITE", label: "Ata/justificativa de comitê", type: "Comitê" },
    { stage: "Compra", requirement: "COMPROVANTE_PAGAMENTO", label: "Comprovante de pagamento", type: "Pagamento" },
    { stage: "Carteira", requirement: "DOCUMENTO_COBRANCA", label: "Evidências de cobrança/liquidação", type: "Comprovante" },
  ].map((requirement) => {
    const linked = documents.filter((doc) => doc.requirement === requirement.requirement || (doc.stage === requirement.stage && doc.type === requirement.type));
    const validLinked = linked.filter((doc) => doc.status === "Válido");
    return { ...requirement, linked: linked.length, valid: validLinked.length, status: validLinked.length ? "Válido" : linked.length ? "Em revisão" : "Pendente" };
  });

  async function uploadDocumentFile(documentId: string, file?: File | null) {
    if (!file) return;
    setUploadingDoc(documentId);
    try {
      const form = new FormData();
      form.set("documentId", documentId);
      form.set("file", file);
      const response = await fetch("/api/documents/upload", { method: "POST", body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Não foi possível enviar o arquivo.");
      onNotice(`Arquivo enviado para ${documentId}.`);
      window.location.reload();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Não foi possível enviar o arquivo.");
    } finally {
      setUploadingDoc(null);
    }
  }

  async function openSignedDocument(documentId: string) {
    try {
      const response = await fetch(`/api/documents/download?id=${encodeURIComponent(documentId)}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Não foi possível gerar link de download.");
      window.open(String(payload.url), "_blank", "noopener,noreferrer");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Não foi possível gerar link de download.");
    }
  }

  return <>
    <div className="kpis"><K label="Documentos" v={String(documents.length)} /><K label="Dossiês completos" v={`${completion}%`} /><K label="Vencendo em 30 dias" v={String(expiringSoon)} /><K label="Críticos" v={String(expired + withoutFile)} /></div>
    <div className="card document-command">
      <div>
        <div className="ctitle">Comando documental</div>
        <p className="muted">Controle de validade, classificação e impacto operacional dos documentos usados em cadastro, compra, carteira e auditoria.</p>
      </div>
      <div className="document-command-grid">
        <div><span>Classificados</span><b>{classified}/{documents.length}</b><small>Etapa e requisito preenchidos</small></div>
        <div><span>Sem arquivo</span><b>{withoutFile}</b><small>Metadado cadastrado sem binário</small></div>
        <div><span>Em revisão</span><b>{review}</b><small>Exigem validação operacional</small></div>
      </div>
    </div>
    <div className="grid">
      <div className="card">
        <div className="ctitle">Dossiês por ativo</div>
        <Table heads={["Ativo", "Cedente / Sacado", "Completude", "Pendências", "Documentos", "Situação"]}>
          {dossiers.map((item) => (
            <tr key={item.receivableId}>
              <td className="mono">{item.receivableId}</td>
              <td><div className="entity">{item.assignor}</div><div className="sub">{item.debtor}</div></td>
              <td className="mono">{item.completion}%</td>
              <td>{item.gaps.length ? item.gaps.map((gap) => gap.label).join(" · ") : "Sem pendências"}</td>
              <td>{item.linkedDocs.length}</td>
              <td><Badge v={item.ok ? "Válido" : item.completion > 50 ? "Em revisão" : "Pendente"} /></td>
            </tr>
          ))}
        </Table>
        {!checklists.length && <div className="note">Sem ativos elegíveis/revisão/aprovados com checklist documental no momento.</div>}
      </div>
      <div className="card">
        <div className="ctitle">Governança documental</div>
        <div className="rule">Documentos válidos<b>{valid}</b></div>
        <div className="rule">Em revisão / pendentes<b>{review}</b></div>
        <div className="rule">Vencidos<b>{expired}</b></div>
        {Object.entries(byStage).map(([stage, count]) => <div className="rule" key={stage}>{stage}<b>{count}</b></div>)}
      </div>
    </div>
    <div className="card">
      <div className="ctitle">Alertas de validade e governança</div>
      <Table heads={["Documento", "Vínculo", "Validade", "Arquivo", "Criticidade", "Impacto", "Ação recomendada"]}>
        {documentHealth
          .filter((item) => item.severity !== "Baixo")
          .sort((a, b) => ["Crítico", "Alto", "Médio", "Baixo"].indexOf(a.severity) - ["Crítico", "Alto", "Médio", "Baixo"].indexOf(b.severity))
          .map(({ doc, days, hasBinary, missingGovernance, status, severity, impact }) => (
            <tr key={doc.id}>
              <td><div className="entity">{doc.name}</div><div className="sub mono">{doc.id}</div></td>
              <td>{doc.entity}</td>
              <td>{days === null ? "Sem vencimento" : days < 0 ? `${Math.abs(days)} dia(s) vencido` : `${days} dia(s)`}<div className="sub">{doc.expiresAt || "Sem data"}</div></td>
              <td><Badge v={hasBinary ? "Arquivo OK" : "Sem arquivo"} /></td>
              <td><Badge v={severity} /><div className="sub">{status}</div></td>
              <td>{impact}</td>
              <td>{missingGovernance ? "Classificar etapa/requisito" : !hasBinary ? "Fazer upload do arquivo" : days !== null && days <= 30 ? "Renovar documento" : "Validar status documental"}</td>
            </tr>
          ))}
      </Table>
      {!documentHealth.some((item) => item.severity !== "Baixo") && <div className="note">Nenhum alerta documental relevante.</div>}
    </div>
    <div className="card">
      <div className="ctitle">Pendências obrigatórias</div>
      <Table heads={["Ativo", "Cedente / Sacado", "Status", "Requisitos pendentes", "Impacto"]}>
        {pending.map((item) => (
          <tr key={item.receivableId}>
            <td className="mono">{item.receivableId}</td>
            <td><div className="entity">{item.assignor}</div><div className="sub">{item.debtor}</div></td>
            <td><Badge v={item.status} /></td>
            <td>{item.gaps.map((gap) => gap.label).join(" · ")}</td>
            <td><Badge v="Atenção" /><div className="sub">Pode bloquear compra ou exigir comitê/documentação</div></td>
          </tr>
        ))}
      </Table>
      {!pending.length && <div className="note">Nenhuma pendência documental obrigatória.</div>}
    </div>
    <div className="card">
      <div className="ctitle">Matriz documental por etapa</div>
      <Table heads={["Etapa", "Requisito", "Tipo", "Documentos", "Válidos", "Status"]}>
        {stageRequirements.map((item) => (
          <tr key={item.requirement}>
            <td>{item.stage}</td>
            <td><div className="entity">{item.label}</div><div className="sub mono">{item.requirement}</div></td>
            <td>{item.type}</td>
            <td>{item.linked}</td>
            <td>{item.valid}</td>
            <td><Badge v={item.status} /></td>
          </tr>
        ))}
      </Table>
    </div>
    <div className="card"><div className="ctitle">Repositório documental {canCreate && <button className="mini" onClick={onAdd}>Adicionar</button>}</div><Table heads={["Código", "Documento", "Tipo", "Etapa / requisito", "Vínculo", "Status", "Vencimento", "Governança", "Arquivo"]}>{documentHealth.map(({ doc, status, severity, hasBinary }) => <tr key={doc.id}><td className="mono">{doc.id}</td><td><div className="entity">{doc.name}</div><div className="sub">{doc.uploadedAt} · {doc.size}</div></td><td>{doc.type}</td><td><div className="entity">{doc.stage || "Sem etapa"}</div><div className="sub">{doc.requirement || "Sem requisito"}</div></td><td>{doc.entity}</td><td><Badge v={doc.status} /></td><td>{doc.expiresAt || "Sem vencimento"}</td><td><Badge v={severity} /><div className="sub">{status} · {hasBinary ? "arquivo OK" : "sem arquivo"}</div></td><td><div className="row-actions"><label className="btn file-action">{uploadingDoc === doc.id ? "Enviando..." : "Upload"}<input hidden type="file" onChange={(event) => uploadDocumentFile(doc.id, event.target.files?.[0])} /></label><button className="btn" onClick={() => openSignedDocument(doc.id)}>Download</button></div></td></tr>)}</Table></div>
  </>;
}

function downloadCsv(filename: string, rows: Record<string, string | number | null | undefined>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: string | number | null | undefined) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [headers.join(";"), ...rows.map((row) => headers.map((header) => escape(row[header])).join(";"))].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ReportsPage({ receivables, audits, cashMovements, fundingIssues }: { receivables: Receivable[]; audits: Audit[]; cashMovements: CashMovement[]; fundingIssues: FundingIssue[] }) {
  const portfolio = receivables.filter((item) => item.portfolioStatus || ["Comprado", "Vencido", "Liquidado"].includes(item.status));
  const openPortfolio = portfolio.filter((item) => item.status !== "Liquidado");
  const pipeline = receivables.filter((item) => !["Comprado", "Vencido", "Liquidado"].includes(item.status));
  const portfolioFace = openPortfolio.reduce((sum, item) => sum + item.valor, 0);
  const outstanding = openPortfolio.reduce((sum, item) => sum + (item.outstandingValue ?? item.valor), 0);
  const acquisitionValue = openPortfolio.reduce((sum, item) => sum + (item.acquisitionValue ?? item.preco ?? priceReceivable(item).purchasePrice), 0);
  const pipelineValue = pipeline.reduce((sum, item) => sum + item.valor, 0);
  const issuedFunding = fundingIssues.filter((item) => item.status === "Emitido").reduce((sum, item) => sum + item.amount, 0);
  const cashNet = cashMovements.reduce((sum, item) => sum + (item.type === "Entrada" ? item.amount : -item.amount), 0);
  const overdue = openPortfolio.filter((item) => item.status === "Vencido" || daysFromToday(item.venc) < 0);
  const avgPrice = portfolioFace ? acquisitionValue / portfolioFace : 0;
  const topAssignorRows = concentrationRows(openPortfolio, "ced", []);
  const topDebtorRows = concentrationRows(openPortfolio, "sac", []);
  const statusRows = ["Importado", "Elegível", "Revisão", "Inelegível", "Aprovado", "Comprado", "Vencido", "Liquidado"].map((status) => {
    const items = receivables.filter((item) => item.status === status);
    return { status, count: items.length, value: items.reduce((sum, item) => sum + item.valor, 0) };
  });
  const exportExecutive = () => downloadCsv("hoam-sumario-executivo.csv", [
    { indicador: "Carteira em aberto", valor: outstanding },
    { indicador: "Valor de aquisição", valor: acquisitionValue },
    { indicador: "Preço médio", valor: avgPrice },
    { indicador: "Pipeline", valor: pipelineValue },
    { indicador: "Funding emitido", valor: issuedFunding },
    { indicador: "Uso do funding", valor: issuedFunding ? outstanding / issuedFunding : 0 },
    { indicador: "Caixa líquido", valor: cashNet },
    { indicador: "Ativos vencidos", valor: overdue.length },
  ]);
  const exportPipeline = () => downloadCsv("hoam-pipeline.csv", receivables.map((item) => ({
    ativo: item.id,
    cedente: item.ced,
    sacado: item.sac,
    emissao: item.emissao,
    vencimento: item.venc,
    valor: item.valor,
    status: item.status,
    confirmacao: item.confirmationStatus ?? "",
    carteira: item.portfolioStatus ?? "",
  })));
  const exportConcentration = () => downloadCsv("hoam-concentracao.csv", [
    ...topAssignorRows.map((item) => ({ dimensao: "Cedente", nome: item.name, exposicao: item.amount, percentual: item.ratio })),
    ...topDebtorRows.map((item) => ({ dimensao: "Sacado", nome: item.name, exposicao: item.amount, percentual: item.ratio })),
  ]);
  const exportPortfolio = () => downloadCsv("hoam-carteira.csv", portfolio.map((item) => ({
    ativo: item.id,
    cedente: item.ced,
    sacado: item.sac,
    emissao: item.emissao,
    vencimento: item.venc,
    valor_face: item.valor,
    valor_aquisicao: item.acquisitionValue ?? item.preco ?? priceReceivable(item).purchasePrice,
    saldo: item.outstandingValue ?? item.valor,
    status: item.portfolioStatus ?? item.status,
  })));
  const exportCash = () => downloadCsv("hoam-caixa.csv", cashMovements.map((item) => ({
    data: item.date,
    conta: item.accountName || item.accountId || "-",
    descricao: item.description,
    tipo: item.type,
    valor: item.amount,
    referencia: item.reference ?? "",
  })));
  const exportFunding = () => downloadCsv("hoam-funding.csv", fundingIssues.map((item) => ({
    id: item.id,
    instrumento: item.instrument,
    valor: item.amount,
    taxa: item.rate,
    vencimento: item.maturity,
    status: item.status,
  })));
  const exportAudits = () => downloadCsv("hoam-audit-logs.csv", audits.map((item) => ({
    id: item.id,
    data: item.at,
    usuario: item.user,
    acao: item.action,
    entidade: item.entity,
  })));

  return <>
    <div className="card report-actions">
      <div>
        <div className="ctitle">Central de relatórios</div>
        <p className="muted">Exporte as principais visões operacionais em CSV com separador ponto e vírgula, pronto para Excel/Power BI.</p>
      </div>
      <div className="row-actions">
        <button className="btn" onClick={exportExecutive}>Exportar sumário</button>
        <button className="btn" disabled={!receivables.length} onClick={exportPipeline}>Exportar pipeline</button>
        <button className="btn" disabled={!portfolio.length} onClick={exportPortfolio}>Exportar carteira</button>
        <button className="btn" disabled={!portfolio.length} onClick={exportConcentration}>Exportar concentração</button>
        <button className="btn" disabled={!cashMovements.length} onClick={exportCash}>Exportar caixa</button>
        <button className="btn" disabled={!fundingIssues.length} onClick={exportFunding}>Exportar funding</button>
        <button className="btn" disabled={!audits.length} onClick={exportAudits}>Exportar auditoria</button>
      </div>
    </div>
    <div className="kpis">
      <K label="Carteira em aberto" v={fmt(outstanding)} />
      <K label="Pipeline" v={fmt(pipelineValue)} />
      <K label="Preço médio" v={fmtPct(avgPrice)} />
      <K label="Uso do funding" v={issuedFunding ? fmtPct(outstanding / issuedFunding) : "Sem emissão"} />
    </div>
    <div className="report-command-grid">
      <div><span>Caixa líquido</span><b>{fmt(cashNet)}</b><small>{cashMovements.length} movimento(s)</small></div>
      <div><span>Ativos vencidos</span><b>{overdue.length}</b><small>{fmt(overdue.reduce((sum, item) => sum + (item.outstandingValue ?? item.valor), 0))}</small></div>
      <div><span>Audit logs</span><b>{audits.length}</b><small>Trilha operacional disponível</small></div>
      <div><span>Funding ativo</span><b>{fmt(issuedFunding)}</b><small>{fundingIssues.filter((item) => item.status === "Emitido").length} emissão(ões)</small></div>
    </div>
    <div className="grid">
      <div className="card"><div className="ctitle">Gestão de caixa</div><Table heads={["Data", "Conta", "Descrição", "Tipo", "Valor"]}>{cashMovements.map((c) => <tr key={c.id}><td>{c.date}</td><td>{c.accountName || c.accountId || "-"}</td><td>{c.description}</td><td><Badge v={c.type} /></td><td className="mono">{fmt(c.amount)}</td></tr>)}</Table></div>
      <div className="card"><div className="ctitle">Funding e emissões</div><Table heads={["Instrumento", "Valor", "Taxa", "Status"]}>{fundingIssues.map((f) => <tr key={f.id}><td>{f.instrument}</td><td>{fmt(f.amount)}</td><td>{f.rate}</td><td><Badge v={f.status} /></td></tr>)}</Table></div>
    </div>
    <div className="grid">
      <div className="card">
        <div className="ctitle">Exposição por status</div>
        <Table heads={["Status", "Quantidade", "Exposição"]}>
          {statusRows.map((row) => <tr key={row.status}><td><Badge v={row.status} /></td><td>{row.count}</td><td className="mono">{fmt(row.value)}</td></tr>)}
        </Table>
      </div>
      <div className="card">
        <div className="ctitle">Concentração de carteira</div>
        <Table heads={["Dimensão", "Nome", "Exposição", "% carteira"]}>
          {topAssignorRows.slice(0, 4).map((row) => <tr key={`ced-${row.name}`}><td>Cedente</td><td>{row.name}</td><td>{fmt(row.amount)}</td><td>{fmtPct(row.ratio)}</td></tr>)}
          {topDebtorRows.slice(0, 4).map((row) => <tr key={`sac-${row.name}`}><td>Sacado</td><td>{row.name}</td><td>{fmt(row.amount)}</td><td>{fmtPct(row.ratio)}</td></tr>)}
        </Table>
      </div>
    </div>
    <div className="grid">
      <div className="card">
        <div className="ctitle">Pipeline operacional</div>
        <Table heads={["Status", "Quantidade", "Valor", "% total"]}>
          {statusRows.map((row) => <tr key={`pipe-${row.status}`}><td><Badge v={row.status} /></td><td>{row.count}</td><td>{fmt(row.value)}</td><td>{fmtPct(receivables.reduce((sum, item) => sum + item.valor, 0) ? row.value / receivables.reduce((sum, item) => sum + item.valor, 0) : 0)}</td></tr>)}
        </Table>
      </div>
      <div className="card"><div className="ctitle">Últimos audit logs</div><div className="audit-list">{audits.slice(0, 7).map((a) => <div className="audit" key={a.id}><span className="mono">{a.id}</span><b>{a.action}</b><small>{a.entity} · {a.user} · {a.at}</small></div>)}</div></div>
    </div>
  </>;
}

function Assets({ ds, owned }: { ds: Receivable[]; owned: string[] }) {
  return <div className="card"><div className="ctitle">Direitos creditórios</div><Table heads={["Ativo", "Cedente / Sacado", "Vencimento", "Valor", "Status"]}>{ds.map((d) => <tr key={d.id}><td className="mono">{d.id}</td><td><div className="entity">{d.ced}</div><div className="sub">{d.sac}</div></td><td>{d.venc}</td><td className="mono">{fmt(d.valor)}</td><td><Badge v={owned.includes(d.id) ? "Em carteira" : d.status} /></td></tr>)}</Table></div>;
}

function AccessControl({ audits, groups, onResendInvite, onToggle, users }: { audits: Audit[]; groups: AccessGroup[]; onResendInvite: (user: AppUser) => void; onToggle: (groupId: string, module: string, action: PermissionAction) => void; users: AppUser[] }) {
  const [selected, setSelected] = useState(groups[0].id);
  const activeGroup = groups.find((g) => g.id === selected) ?? groups[0];
  const permissionCount = (group: AccessGroup) => Object.values(group.permissions).reduce((sum, permissions) => sum + permissions.length, 0);
  const groupRisks = groups.map((group) => {
    const canApproveCredit = group.permissions["Comitê"]?.includes("approve") || group.permissions["Risco"]?.includes("approve");
    const canBuy = group.permissions["Compra"]?.includes("purchase") || group.permissions["Compra"]?.includes("create");
    const canAdmin = modules.some((module) => group.permissions[module]?.includes("admin"));
    const canEditUsers = group.permissions["Usuários"]?.includes("admin") || group.permissions["Usuários"]?.includes("create");
    const canEditCash = group.permissions["Caixa"]?.includes("create") || group.permissions["Caixa"]?.includes("admin");
    const canReconcile = group.permissions["Caixa"]?.includes("approve") || group.permissions["Caixa"]?.includes("admin");
    const risks = [
      canApproveCredit && canBuy ? "Aprova crédito e compra ativos" : "",
      canEditCash && canReconcile ? "Lança e aprova/conciliaria caixa" : "",
      canEditUsers && canAdmin ? "Administra usuários e possui poderes administrativos" : "",
      permissionCount(group) > modules.length * 3 ? "Perfil muito amplo" : "",
    ].filter(Boolean);
    const severity = group.id === "admin" || risks.length >= 2 ? "Crítico" : risks.length === 1 ? "Alto" : "Baixo";
    return { group, risks, severity, permissionCount: permissionCount(group) };
  });
  const selectedRisk = groupRisks.find((item) => item.group.id === activeGroup.id) ?? groupRisks[0];
  const privilegedGroups = groupRisks.filter((item) => item.severity !== "Baixo");
  const privilegedUsers = users.filter((user) => {
    const risk = groupRisks.find((item) => item.group.id === user.groupId);
    return risk?.severity !== "Baixo";
  });
  const inactiveOrInvited = users.filter((user) => user.status !== "Ativo");
  const accessAudits = audits.filter((audit) => /USER|PERMISSION|ACCESS|LOGIN|LOGOUT|AUTH|GROUP/i.test(`${audit.action} ${audit.entity}`));
  return <>
    <div className="kpis"><K label="Usuários ativos" v={String(users.filter((u) => u.status === "Ativo").length)} /><K label="Usuários privilegiados" v={String(privilegedUsers.length)} /><K label="Grupos com risco SoD" v={String(privilegedGroups.length)} /><K label="Convites/bloqueados" v={String(inactiveOrInvited.length)} /></div>
    <div className="card access-command">
      <div>
        <div className="ctitle">Comando de acessos</div>
        <p className="muted">Governança de perfis, segregação de funções e revisão de poderes críticos.</p>
      </div>
      <div className="access-command-grid">
        <div><span>Permissões disponíveis</span><b>{modules.length * actions.length}</b><small>{modules.length} módulos · {actions.length} ações</small></div>
        <div><span>Grupo selecionado</span><b>{activeGroup.name}</b><small>{selectedRisk?.permissionCount ?? 0} permissões ativas</small></div>
        <div><span>Risco do grupo</span><b>{selectedRisk?.severity ?? "Baixo"}</b><small>{selectedRisk?.risks[0] ?? "Sem conflito material"}</small></div>
      </div>
    </div>
    <div className="grid access-grid">
      <div className="card">
        <div className="ctitle">Usuários corporativos</div>
        <Table heads={["Usuário", "Grupo", "Risco", "Status", "Último acesso", "Ações"]}>
          {users.map((user) => {
            const group = groups.find((item) => item.id === user.groupId);
            const risk = groupRisks.find((item) => item.group.id === user.groupId);
            return (
              <tr key={user.id}>
                <td><div className="entity">{user.name}</div><div className="sub">{user.email}</div></td>
                <td>{group?.name ?? "Sem grupo"}</td>
                <td><Badge v={risk?.severity ?? "Baixo"} /><div className="sub">{risk?.risks[0] ?? "Perfil regular"}</div></td>
                <td><Badge v={user.status} /></td>
                <td className="mono">{user.lastAccess}</td>
                <td>{user.status === "Convite pendente" ? <button className="mini" onClick={() => onResendInvite(user)}>Reenviar convite</button> : <span className="sub">—</span>}</td>
              </tr>
            );
          })}
        </Table>
      </div>
      <div className="card">
        <div className="ctitle">Grupos e segregação de funções</div>
        <div className="group-list">{groups.map((group) => {
          const risk = groupRisks.find((item) => item.group.id === group.id);
          return <button className={selected === group.id ? "group active" : "group"} key={group.id} onClick={() => setSelected(group.id)}><span><b>{group.name}</b><small>{group.description}</small><small><Badge v={risk?.severity ?? "Baixo"} /> {risk?.permissionCount ?? 0} permissão(ões)</small></span><em>{group.users}</em></button>;
        })}</div>
      </div>
    </div>
    <div className="grid access-grid">
      <div className="card">
        <div className="ctitle">Matriz de permissões · {activeGroup.name}{activeGroup.id === "admin" && <span> · perfil protegido</span>}</div>
        <div className="access-risk-box">
          <Badge v={selectedRisk?.severity ?? "Baixo"} />
          <span>{selectedRisk?.risks.length ? selectedRisk.risks.join(" · ") : "Nenhum conflito de segregação material identificado para este grupo."}</span>
        </div>
        <div className="permission-matrix"><div className="permission-row permission-head"><b>Módulo</b>{actions.map((action) => <b key={action.key}>{action.label}</b>)}</div>{modules.map((module) => <div className="permission-row" key={module}><span>{module}</span>{actions.map((action) => <label className="checkcell" key={action.key}><input checked={activeGroup.permissions[module]?.includes(action.key) ?? false} disabled={activeGroup.id === "admin"} onChange={() => onToggle(activeGroup.id, module, action.key)} type="checkbox" /><i /></label>)}</div>)}</div>
      </div>
      <div className="card">
        <div className="ctitle">Riscos de acesso e auditoria</div>
        <Table heads={["Grupo", "Risco", "Achados"]}>
          {groupRisks.map((item) => <tr key={item.group.id}><td>{item.group.name}</td><td><Badge v={item.severity} /></td><td>{item.risks.length ? item.risks.join(" · ") : "Sem conflito material"}</td></tr>)}
        </Table>
        <div className="ctitle">Audit log de acessos</div>
        <div className="audit-list">{(accessAudits.length ? accessAudits : audits).slice(0, 8).map((audit) => <div className="audit" key={audit.id}><span className="mono">{audit.id}</span><b>{audit.action}</b><small>{audit.entity} · {audit.user} · {audit.at}</small></div>)}</div>
      </div>
    </div>
  </>;
}

function AssignorModal({
  title,
  initial,
  onSubmit,
  close,
}: {
  title: string;
  initial?: Assignor;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  close: () => void;
}) {
  const procurador = initial?.procuradores?.[0];
  const beneficiario = initial?.beneficiariosFinais?.[0];
  return (
    <div className="modalback">
      <form className="modal wide-modal" onSubmit={onSubmit}>
        <h2>{title}</h2>
        <p className="muted">Dossiê institucional do cedente: dados cadastrais, procuradores, beneficiários finais e compliance.</p>

        <div className="section-title">Dados da empresa</div>
        <div className="formgrid">
          <Field label="Razão social" name="nome" value={initial?.nome} />
          <Field label="Nome fantasia" name="nomeFantasia" value={initial?.nomeFantasia ?? ""} required={false} />
          <Field label="CNPJ" name="doc" value={initial?.doc} />
          <Field label="Segmento" name="extra" value={initial?.setor} />
          <Field label="Inscrição estadual" name="inscricaoEstadual" value={initial?.inscricaoEstadual ?? ""} required={false} />
          <Field label="Inscrição municipal" name="inscricaoMunicipal" value={initial?.inscricaoMunicipal ?? ""} required={false} />
          <Field label="Fundação" name="fundacao" value={initial?.fundacao ?? ""} required={false} />
          <Field label="Grupo econômico" name="grupoEconomico" value={initial?.grupoEconomico ?? ""} required={false} />
          <Field label="Receita anual estimada" name="receitaAnual" value={String(initial?.receitaAnual ?? "")} type="number" required={false} />
          <Field label="Funcionários" name="funcionarios" value={String(initial?.funcionarios ?? "")} type="number" required={false} />
          <Field label="Limite de crédito" name="valor" value={String(initial?.limite ?? "")} type="number" />
          <Field label="Gerente HOAM" name="gerenteRelacionamento" value={initial?.gerenteRelacionamento ?? ""} required={false} />
        </div>

        <div className="section-title">Contato e endereço</div>
        <div className="formgrid">
          <Field label="E-mail" name="email" value={initial?.email ?? ""} type="email" required={false} />
          <Field label="Telefone" name="telefone" value={initial?.telefone ?? ""} required={false} />
          <Field label="Website" name="site" value={initial?.site ?? ""} required={false} />
          <Field label="Endereço" name="endereco" value={initial?.endereco ?? ""} required={false} />
          <Field label="Cidade" name="cidade" value={initial?.cidade ?? ""} required={false} />
          <Field label="UF" name="uf" value={initial?.uf ?? ""} required={false} />
        </div>

        <div className="section-title">Procurador / representante</div>
        <div className="formgrid">
          <Field label="Nome do procurador" name="procuradorNome" value={procurador?.nome ?? ""} required={false} />
          <Field label="CPF" name="procuradorCpf" value={procurador?.cpf ?? ""} required={false} />
          <Field label="Cargo" name="procuradorCargo" value={procurador?.cargo ?? ""} required={false} />
          <Field label="E-mail" name="procuradorEmail" value={procurador?.email ?? ""} type="email" required={false} />
          <Field label="Telefone" name="procuradorTelefone" value={procurador?.telefone ?? ""} required={false} />
          <Field label="Poderes" name="procuradorPoderes" value={procurador?.poderes ?? ""} required={false} />
          <Field label="Validade do mandato" name="procuradorValidade" value={procurador?.validadeMandato ?? ""} required={false} />
        </div>

        <div className="section-title">Beneficiário final e compliance</div>
        <div className="formgrid">
          <Field label="Beneficiário final" name="beneficiarioNome" value={beneficiario?.nome ?? ""} required={false} />
          <Field label="CPF beneficiário" name="beneficiarioCpf" value={beneficiario?.cpf ?? ""} required={false} />
          <Field label="% participação" name="beneficiarioParticipacao" value={String(beneficiario?.participacao ?? "")} type="number" required={false} />
          <SelectField label="PEP beneficiário" name="beneficiarioPep" defaultValue={beneficiario?.pep ?? "Não informado"} options={["Não informado", "Não", "Sim"].map((x) => [x, x])} />
          <SelectField label="Etapa onboarding" name="etapaOnboarding" defaultValue={initial?.etapaOnboarding ?? "Cadastro inicial"} options={["Cadastro inicial", "Documentação pendente", "Em compliance", "Aprovado para operar", "Bloqueado"].map((x) => [x, x])} />
          <SelectField label="Compliance" name="complianceStatus" defaultValue={initial?.complianceStatus ?? "Pendente"} options={["Pendente", "Em análise", "Aprovado", "Aprovado com ressalvas", "Reprovado"].map((x) => [x, x])} />
          <SelectField label="KYC" name="kycStatus" defaultValue={initial?.kycStatus ?? "Pendente"} options={["Pendente", "Válido", "Vencido", "Em revisão"].map((x) => [x, x])} />
          <SelectField label="Sanções / listas restritivas" name="consultaSancoes" defaultValue={initial?.consultaSancoes ?? "Não consultado"} options={["Não consultado", "Sem apontamentos", "Com apontamentos", "Bloqueado"].map((x) => [x, x])} />
          <SelectField label="Exposição PEP" name="exposicaoPep" defaultValue={initial?.exposicaoPep ?? "Não informado"} options={["Não informado", "Não", "Sim", "Relacionado"].map((x) => [x, x])} />
          <Field label="Última revisão compliance" name="ultimaRevisaoCompliance" value={initial?.ultimaRevisaoCompliance ?? ""} required={false} />
          <SelectField
            label="Status operacional"
            name="status"
            defaultValue={initial?.status ?? "Ativo"}
            options={[
              ["Ativo", "Ativo"],
              ["Em análise", "Em análise"],
              ["Monitorar", "Monitorar"],
              ["Bloqueado", "Bloqueado"],
              ["Inativo", "Inativo"],
            ]}
          />
        </div>
        <div className="field full-field">
          <label htmlFor="field-parecerCompliance">Parecer de compliance</label>
          <textarea id="field-parecerCompliance" name="parecerCompliance" defaultValue={initial?.parecerCompliance ?? ""} />
        </div>

        <div className="actions">
          <button type="button" className="btn" onClick={close}>Cancelar</button>
          <button className="btn gold">Salvar dossiê do cedente</button>
        </div>
      </form>
    </div>
  );
}

function DebtorModal({
  title,
  initial,
  onSubmit,
  close,
}: {
  title: string;
  initial?: Debtor;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  close: () => void;
}) {
  return (
    <div className="modalback">
      <form className="modal wide-modal" onSubmit={onSubmit}>
        <h2>{title}</h2>
        <p className="muted">Cadastro operacional do sacado para confirmação de lastro, concentração de risco e follow-up de contas a pagar.</p>

        <div className="section-title">Dados do sacado</div>
        <div className="formgrid">
          <Field label="Razão social" name="nome" value={initial?.nome} />
          <Field label="Nome fantasia" name="nomeFantasia" value={initial?.nomeFantasia ?? ""} required={false} />
          <Field label="CNPJ" name="doc" value={initial?.doc} />
          <Field label="Rating" name="extra" value={initial?.rating} />
          <Field label="Exposição / limite" name="valor" value={String(initial?.valor ?? "")} type="number" />
          <Field label="Website" name="site" value={initial?.site ?? ""} required={false} />
        </div>

        <div className="section-title">Contato e endereço</div>
        <div className="formgrid">
          <Field label="E-mail geral" name="email" value={initial?.email ?? ""} type="email" required={false} />
          <Field label="Telefone geral" name="telefone" value={initial?.telefone ?? ""} required={false} />
          <Field label="Endereço" name="endereco" value={initial?.endereco ?? ""} required={false} />
          <Field label="Cidade" name="cidade" value={initial?.cidade ?? ""} required={false} />
          <Field label="UF" name="uf" value={initial?.uf ?? ""} required={false} />
        </div>

        <div className="section-title">Contato financeiro / confirmação</div>
        <div className="formgrid">
          <Field label="Nome do contato financeiro" name="contatoFinanceiroNome" value={initial?.contatoFinanceiroNome ?? ""} required={false} />
          <Field label="Cargo / área" name="contatoFinanceiroCargo" value={initial?.contatoFinanceiroCargo ?? ""} required={false} />
          <Field label="E-mail financeiro" name="contatoFinanceiroEmail" value={initial?.contatoFinanceiroEmail ?? ""} type="email" required={false} />
          <Field label="Telefone financeiro" name="contatoFinanceiroTelefone" value={initial?.contatoFinanceiroTelefone ?? ""} required={false} />
          <Field label="E-mail de confirmação" name="emailConfirmacao" value={initial?.emailConfirmacao ?? ""} type="email" required={false} />
          <Field label="Telefone de confirmação" name="telefoneConfirmacao" value={initial?.telefoneConfirmacao ?? ""} required={false} />
          <SelectField label="Canal preferencial" name="canalConfirmacao" defaultValue={initial?.canalConfirmacao ?? "E-mail"} options={["E-mail", "Telefone", "WhatsApp", "Portal", "EDI/API"].map((x) => [x, x])} />
          <Field label="Janela de confirmação" name="janelaConfirmacao" value={initial?.janelaConfirmacao ?? ""} required={false} />
          <SelectField label="Status da confirmação" name="statusConfirmacao" defaultValue={initial?.statusConfirmacao ?? "Pendente"} options={["Pendente", "Confirmado", "Divergente", "Sem resposta", "Bloqueado"].map((x) => [x, x])} />
          <Field label="Última confirmação" name="ultimaConfirmacao" value={initial?.ultimaConfirmacao ?? ""} required={false} />
        </div>

        <div className="section-title">Histórico e observações</div>
        <div className="formgrid">
          <SelectField label="Histórico de protestos" name="historicoProtestos" defaultValue={initial?.historicoProtestos ?? "Não consultado"} options={["Não consultado", "Sem apontamentos", "Com apontamentos"].map((x) => [x, x])} />
          <SelectField label="Comportamento de pagamento" name="comportamentoPagamento" defaultValue={initial?.comportamentoPagamento ?? "Sem histórico"} options={["Sem histórico", "Pontual", "Atrasos leves", "Atrasos recorrentes"].map((x) => [x, x])} />
          <SelectField
            label="Status operacional"
            name="status"
            defaultValue={initial?.status ?? "Ativo"}
            options={[
              ["Ativo", "Ativo"],
              ["Em análise", "Em análise"],
              ["Monitorar", "Monitorar"],
              ["Bloqueado", "Bloqueado"],
              ["Inativo", "Inativo"],
            ]}
          />
        </div>
        <div className="field full-field">
          <label htmlFor="field-evidenciaRelacionamento">Evidência de relacionamento comercial</label>
          <textarea id="field-evidenciaRelacionamento" name="evidenciaRelacionamento" defaultValue={initial?.evidenciaRelacionamento ?? ""} />
        </div>
        <div className="field full-field">
          <label htmlFor="field-observacaoConfirmacao">Observação de confirmação</label>
          <textarea id="field-observacaoConfirmacao" name="observacaoConfirmacao" defaultValue={initial?.observacaoConfirmacao ?? ""} />
        </div>
        <div className="field full-field">
          <label htmlFor="field-observacoesOperacionais">Observações operacionais</label>
          <textarea id="field-observacoesOperacionais" name="observacoesOperacionais" defaultValue={initial?.observacoesOperacionais ?? ""} />
        </div>

        <div className="actions">
          <button type="button" className="btn" onClick={close}>Cancelar</button>
          <button className="btn gold">Salvar cadastro do sacado</button>
        </div>
      </form>
    </div>
  );
}

function UserModal({ close, groups, save }: { close: () => void; groups: AccessGroup[]; save: (e: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modalback"><form className="modal" onSubmit={save}><h2>Novo usuário</h2><p className="muted">Defina o grupo de acesso e uma senha provisória. A criação será persistida e auditada.</p><div className="formgrid"><Field label="Nome completo" name="nome" /><Field label="E-mail corporativo" name="email" type="email" /><Field label="Senha provisória" name="password" type="password" /><SelectField label="Grupo de permissões" name="group" options={groups.map((g) => [g.id, g.name])} /><SelectField label="Status inicial" name="status" options={[["Convite pendente", "Convite pendente"], ["Ativo", "Ativo"], ["Bloqueado", "Bloqueado"]]} /></div><div className="actions"><button type="button" className="btn" onClick={close}>Cancelar</button><button className="btn gold">Criar usuário</button></div></form></div>;
}

function AssignorPortalUserModal({ assignor, close, save }: { assignor: Assignor; close: () => void; save: (e: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="modalback">
      <form className="modal wide-modal" onSubmit={save}>
        <h2>Criar usuário do cedente</h2>
        <p className="muted">
          Convide representantes externos de {assignor.nome} para a futura assinatura de contratos, termos e envio de documentos. O vínculo fica restrito ao cedente selecionado.
        </p>
        <div className="formgrid">
          <Field label="Cedente" name="assignor" value={assignor.nome} required={false} />
          <Field label="Nome completo" name="nome" />
          <Field label="E-mail do representante" name="email" type="email" />
          <SelectField
            label="Papel no portal"
            name="role"
            options={["Representante legal", "Procurador", "Financeiro", "Operacional", "Contador / jurídico"].map((x) => [x, x])}
          />
          <Field label="Senha provisória" name="password" value="PortalHOAM@2026" type="password" />
          <SelectField label="Status inicial" name="status" defaultValue="Ativo" options={[["Ativo", "Ativo"], ["Convite pendente", "Convite pendente"]]} />
        </div>
        <div className="card soft-card">
          <div className="ctitle">Governança do convite</div>
          <p className="muted">
            O usuário fica no grupo “Cedente externo”, separado dos perfis internos e vinculado somente a este cedente. Use “Ativo” quando ele já puder acessar o portal.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={close}>Cancelar</button>
          <button className="btn gold">Criar convite do portal</button>
        </div>
      </form>
    </div>
  );
}

function DocumentModal({ close, save }: { close: () => void; save: (e: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modalback"><form className="modal wide-modal" onSubmit={save}><h2>Novo documento</h2><p className="muted">Cadastre a evidência, etapa, requisito e vínculo operacional. O binário será conectado ao storage dedicado na próxima etapa.</p><div className="formgrid"><Field label="Nome do arquivo" name="nome" /><Field label="Entidade vinculada" name="entity" /><SelectField label="Tipo" name="tipo" options={["Contrato", "Lastro", "Comprovante", "KYC", "Borderô", "Comitê", "Pagamento", "Procuração"].map((x) => [x, x])} /><SelectField label="Etapa" name="stage" options={["Cadastro", "Importação", "Confirmação", "Comitê", "Compra", "Carteira"].map((x) => [x, x])} /><SelectField label="Requisito" name="requirement" options={[["BORDERO_IMPORTACAO", "Borderô de importação"], ["COMPROVANTE_LASTRO", "Comprovante de lastro"], ["EVIDENCIA_CONFIRMACAO", "Evidência de confirmação"], ["ATA_COMITE", "Ata/justificativa do comitê"], ["COMPROVANTE_PAGAMENTO", "Comprovante de pagamento"], ["KYC_CEDENTE", "KYC cedente"], ["PROCURACAO", "Procuração"]]} /><Field label="Vencimento" name="expiresAt" type="date" required={false} /><Field label="Tamanho em bytes" name="sizeBytes" value="0" /></div><div className="actions"><button type="button" className="btn" onClick={close}>Cancelar</button><button className="btn gold">Salvar documento</button></div></form></div>;
}

function ConfirmationModal({ close, receivable, save }: { close: () => void; receivable: Receivable; save: (e: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="modalback">
      <form className="modal wide-modal" onSubmit={save}>
        <h2>Confirmar duplicata {receivable.id}</h2>
        <p className="muted">{receivable.ced} · {receivable.sac} · vencimento {receivable.venc} · {fmt(receivable.valor)}</p>
        <div className="formgrid">
          <SelectField
            label="Status da confirmação"
            name="confirmationStatus"
            defaultValue={receivable.confirmationStatus ?? "Pendente"}
            options={["Pendente", "Confirmado", "Divergente", "Sem resposta", "Dispensado"].map((x) => [x, x])}
          />
          <SelectField
            label="Canal"
            name="confirmationChannel"
            defaultValue={receivable.confirmationChannel ?? "E-mail"}
            options={["E-mail", "Telefone", "WhatsApp", "Portal", "EDI/API", "Documento"].map((x) => [x, x])}
          />
          <Field label="Evidência / protocolo" name="confirmationEvidence" value={receivable.confirmationEvidence ?? ""} required={false} />
        </div>
        <div className="field full-field">
          <label htmlFor="field-confirmationNotes">Observações da confirmação</label>
          <textarea id="field-confirmationNotes" name="confirmationNotes" defaultValue={receivable.confirmationNotes ?? ""} />
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={close}>Cancelar</button>
          <button className="btn gold">Salvar confirmação</button>
        </div>
      </form>
    </div>
  );
}

function CommitteeModal({ close, receivable, save }: { close: () => void; receivable: Receivable; save: (e: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="modalback">
      <form className="modal wide-modal" onSubmit={save}>
        <h2>Decisão do comitê · {receivable.id}</h2>
        <p className="muted">{receivable.ced} · {receivable.sac} · {fmt(receivable.valor)} · status atual {receivable.status}</p>
        <div className="formgrid">
          <SelectField
            label="Decisão"
            name="decision"
            defaultValue="approve"
            options={[
              ["approve", "Aprovar exceção para compra"],
              ["reject", "Reprovar / manter inelegível"],
              ["request_documents", "Solicitar documentos / manter revisão"],
              ["return_confirmation", "Devolver para confirmação"],
            ]}
          />
          <Field label="Referência / evidência" name="reference" value={receivable.confirmationEvidence ?? ""} required={false} />
        </div>
        <div className="field full-field">
          <label htmlFor="field-justification">Justificativa obrigatória</label>
          <textarea id="field-justification" name="justification" required defaultValue="" />
        </div>
        <div className="note">A aprovação muda o ativo para Aprovado e libera a compra. Reprovação mantém/retorna o ativo como Inelegível. Todas as decisões são auditadas.</div>
        <div className="actions">
          <button type="button" className="btn" onClick={close}>Cancelar</button>
          <button className="btn gold">Registrar decisão</button>
        </div>
      </form>
    </div>
  );
}

function SettlementModal({ close, receivable, save }: { close: () => void; receivable: Receivable; save: (e: FormEvent<HTMLFormElement>) => void }) {
  const outstanding = receivable.outstandingValue ?? receivable.valor;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="modalback">
      <form className="modal wide-modal" onSubmit={save}>
        <h2>Cobrança / liquidação · {receivable.id}</h2>
        <p className="muted">{receivable.ced} · {receivable.sac} · saldo em aberto {fmt(outstanding)}</p>
        <div className="formgrid">
          <SelectField
            label="Evento"
            name="action"
            defaultValue="settle"
            options={[
              ["settle", "Registrar recebimento"],
              ["mark_overdue", "Marcar vencido / em cobrança"],
              ["renegotiate", "Registrar renegociação"],
            ]}
          />
          <Field label="Valor recebido" name="amount" value={String(outstanding.toFixed(2))} type="number" required={false} />
          <Field label="Data do evento" name="date" value={today} type="date" />
          <SelectField
            label="Método"
            name="method"
            defaultValue="Boleto"
            options={["Boleto", "PIX", "TED", "Transferência", "Câmara", "Outro"].map((x) => [x, x])}
          />
          <SelectField
            label="Canal de contato"
            name="channel"
            defaultValue="E-mail"
            options={["E-mail", "Telefone", "WhatsApp", "Portal bancário", "Assessoria", "Jurídico", "Outro"].map((x) => [x, x])}
          />
          <Field label="Contato / protocolo" name="contact" required={false} />
          <Field label="Próxima ação" name="nextAction" value="Acompanhar pagamento" required={false} />
          <Field label="Responsável" name="owner" value="Operações HOAM" required={false} />
          <Field label="Evidência" name="evidence" required={false} />
        </div>
        <div className="field full-field">
          <label htmlFor="field-notes">Observações / evidência</label>
          <textarea id="field-notes" name="notes" placeholder="Ex.: comprovante, protocolo bancário, tratativa com sacado, nova data acordada..." />
        </div>
        <div className="note">Recebimentos geram entrada de caixa. Eventos de cobrança/renegociação atualizam a carteira sem movimentar caixa.</div>
        <div className="actions">
          <button type="button" className="btn" onClick={close}>Cancelar</button>
          <button className="btn gold">Registrar evento</button>
        </div>
      </form>
    </div>
  );
}

function CashAccountModal({ close, save }: { close: () => void; save: (e: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="modalback">
      <form className="modal wide-modal" onSubmit={save}>
        <h2>Nova conta do warehouse</h2>
        <p className="muted">Cadastre a conta operacional que será usada no fluxo de compra, recebimento, reserva ou funding.</p>
        <div className="formgrid">
          <Field label="Nome da conta" name="name" />
          <Field label="Banco" name="bankName" required={false} />
          <Field label="Agência" name="branch" required={false} />
          <Field label="Conta" name="accountNumber" required={false} />
          <SelectField label="Tipo" name="accountType" options={["Conta movimento", "Conta recebimento", "Conta reserva", "Escrow", "Conta vinculada"].map((x) => [x, x])} />
          <SelectField label="Finalidade" name="purpose" options={[["PURCHASE_SETTLEMENT", "Liquidação de compras"], ["RECEIVABLE_COLLECTION", "Recebimento de sacados"], ["RESERVE", "Reserva operacional"], ["FUNDING", "Funding / emissão"], ["OPERATING", "Operacional"]]} />
          <Field label="Saldo inicial" name="openingBalance" value="0" type="number" />
          <SelectField label="Status" name="status" options={["Ativa", "Em implantação", "Bloqueada", "Inativa"].map((x) => [x, x])} />
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={close}>Cancelar</button>
          <button className="btn gold">Salvar conta</button>
        </div>
      </form>
    </div>
  );
}

function CashMovementModal({ accounts, close, save }: { accounts: CashAccount[]; close: () => void; save: (e: FormEvent<HTMLFormElement>) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="modalback">
      <form className="modal wide-modal" onSubmit={save}>
        <h2>Novo movimento de caixa</h2>
        <p className="muted">Lançamento manual auditável. Compras e liquidações também alimentam o caixa automaticamente.</p>
        <div className="formgrid">
          <SelectField label="Conta" name="accountId" options={accounts.map((account) => [account.id, `${account.name} · ${fmt(account.balance)}`])} />
          <SelectField label="Tipo" name="type" options={[["INFLOW", "Entrada"], ["OUTFLOW", "Saída"]]} />
          <Field label="Valor" name="amount" type="number" />
          <Field label="Data" name="date" value={today} type="date" />
          <Field label="Descrição" name="description" />
          <Field label="Referência" name="reference" required={false} />
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={close}>Cancelar</button>
          <button className="btn gold">Lançar movimento</button>
        </div>
      </form>
    </div>
  );
}

function BankStatementModal({ accounts, close, save }: { accounts: CashAccount[]; close: () => void; save: (e: FormEvent<HTMLFormElement>) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="modalback">
      <form className="modal wide-modal" onSubmit={save}>
        <h2>Novo item de extrato</h2>
        <p className="muted">Registre uma linha do extrato bancário para conciliar contra o razão de caixa.</p>
        <div className="formgrid">
          <SelectField label="Conta" name="accountId" options={accounts.map((account) => [account.id, account.name])} />
          <SelectField label="Tipo" name="type" options={[["INFLOW", "Entrada"], ["OUTFLOW", "Saída"]]} />
          <Field label="Valor" name="amount" type="number" />
          <Field label="Data no extrato" name="date" value={today} type="date" />
          <Field label="Descrição do banco" name="description" />
          <Field label="Referência bancária" name="reference" required={false} />
        </div>
        <div className="field full-field">
          <label htmlFor="field-notes">Observações</label>
          <textarea id="field-notes" name="notes" placeholder="Ex.: linha importada do OFX/CNAB, ID da transação, comentário de conciliação..." />
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={close}>Cancelar</button>
          <button className="btn gold">Salvar extrato</button>
        </div>
      </form>
    </div>
  );
}

function FundingModal({ close, save }: { close: () => void; save: (e: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="modalback">
      <form className="modal wide-modal" onSubmit={save}>
        <h2>Nova emissão / linha de funding</h2>
        <p className="muted">Cadastre o instrumento de captação que financiará a carteira warehouse.</p>
        <div className="formgrid">
          <Field label="Instrumento" name="instrument" value="FIDC Sênior Série" />
          <Field label="Valor" name="amount" type="number" />
          <Field label="Taxa" name="rate" value="CDI + 2,50%" />
          <Field label="Vencimento" name="maturity" type="date" required={false} />
          <SelectField label="Status" name="status" options={["Estruturando", "Emitido", "Liquidado"].map((x) => [x, x])} />
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={close}>Cancelar</button>
          <button className="btn gold">Salvar funding</button>
        </div>
      </form>
    </div>
  );
}

function SelectField({ label, name, options, defaultValue }: { label: string; name: string; options: string[][]; defaultValue?: string }) {
  const id = `field-${name}`;
  return <div className="field"><label htmlFor={id}>{label}</label><select id={id} name={name} defaultValue={defaultValue}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>;
}

function cleanDisplayText(value: unknown) {
  return String(value ?? "Não informado")
    .replaceAll("undefined", "Não informado")
    .replaceAll("OperaÃ§Ãµes", "Operações")
    .replaceAll("operaÃ§Ã£o", "operação")
    .replaceAll("operaÃ§Ãµes", "operações")
    .replaceAll("aprovaÃ§Ã£o", "aprovação")
    .replaceAll("exposiÃ§Ã£o", "exposição")
    .replaceAll("usuÃ¡rios", "usuários")
    .replaceAll("CrÃ©dito", "Crédito")
    .replaceAll("ComitÃª", "Comitê")
    .replaceAll("VisÃ£o", "Visão")
    .replaceAll("ImportaÃ§Ã£o", "Importação")
    .replaceAll("ConfirmaÃ§Ã£o", "Confirmação")
    .replaceAll("CobranÃ§a", "Cobrança")
    .replaceAll("gestÃ£o", "gestão")
    .replaceAll("anÃ¡lise", "análise")
    .replaceAll("invÃ¡lido", "inválido")
    .replaceAll("obrigatÃ³rio", "obrigatório")
    .replaceAll("Opera??es", "Operações")
    .replaceAll("opera??o", "operação")
    .replaceAll("opera??es", "operações")
    .replaceAll("aprova??o", "aprovação")
    .replaceAll("exposi??o", "exposição")
    .replaceAll("n??o", "não")
    .replaceAll("N??o", "Não")
    .replaceAll("usu??rios", "usuários");
}

function DetailModal({ detail, close }: { detail: { title: string; rows: [string, string][] }; close: () => void }) {
  return (
    <div className="modalback" onClick={close}>
      <div className="modal detail-modal" onClick={(event) => event.stopPropagation()}>
        <div className="detail-modal-head">
          <div>
            <h2>{cleanDisplayText(detail.title)}</h2>
            <p className="muted">Visão detalhada da entidade.</p>
          </div>
          <button aria-label="Fechar detalhe" className="modal-close" onClick={close} type="button">×</button>
        </div>
        <div className="detail-modal-body">
          {detail.rows.map(([k, v]) => <div className="rule" key={k}>{cleanDisplayText(k)}<b>{cleanDisplayText(v)}</b></div>)}
        </div>
        <div className="detail-modal-actions">
          <button className="btn gold" onClick={close} type="button">Voltar</button>
        </div>
      </div>
    </div>
  );
}

function Upload({ close, done }: { close: () => void; done: (file?: File | null) => void }) {
  const [file, setFile] = useState<File | null>(null);
  return <div className="modalback"><div className="modal"><h2>Importar duplicatas</h2><p className="muted">CSV real com validação. XLSX aceito como pré-validação demonstrativa.</p><label className="upload"><UploadCloud /><br />{file?.name || "Selecione ou arraste seu arquivo"}<input hidden type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label><div className="actions"><button className="btn" onClick={close}>Cancelar</button><button className="btn gold" onClick={() => done(file)}>Validar e importar</button></div></div></div>;
}

function Table({ heads, children }: { heads: string[]; children: ReactNode }) {
  return <div style={{ overflowX: "auto" }}><table><thead><tr>{heads.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

function Badge({ v }: { v: string }) {
  const warn = ["Revisão", "Em análise", "Monitorar", "Convite pendente", "Com erros", "Em revisão", "Estruturando", "Pendente", "Sem resposta", "Atenção", "Liquidação parcial", "Renegociado", "Alto", "Médio", "Rascunho", "Em aprovação", "Vence em breve", "Classificar", "Sem arquivo"].includes(v);
  const danger = ["Bloqueado", "Inelegível", "Vencido", "Divergente", "Em cobrança", "Crítico", "Crítica", "Reprovada", "Cancelada"].includes(v);
  return <span className={danger ? "badge danger" : warn ? "badge warn" : "badge"}>{v}</span>;
}

function Flow() {
  return <div className="flow">{["Arquivo recebido|CSV ou XLSX", "Validação estrutural|100% automático", "Elegibilidade|Regras vigentes", "Aprovação|Alçada operacional", "Compra|Liquidação"].map((x) => { const [a, b] = x.split("|"); return <div key={a}>{a}<b>{b}</b></div>; })}</div>;
}





