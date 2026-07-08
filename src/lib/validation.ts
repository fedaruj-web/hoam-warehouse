import type { EntityStatus } from "./types";

export type EntityInput = {
  nome: string;
  doc: string;
  extra: string;
  valor: number;
  status: EntityStatus;
};

export type AssignorInput = EntityInput & {
  nomeFantasia?: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  fundacao?: string;
  site?: string;
  email?: string;
  telefone?: string;
  endereco?: string;
  cidade?: string;
  uf?: string;
  grupoEconomico?: string;
  receitaAnual?: number;
  funcionarios?: number;
  gerenteRelacionamento?: string;
  etapaOnboarding?: string;
  complianceStatus?: string;
  kycStatus?: string;
  consultaSancoes?: string;
  exposicaoPep?: string;
  parecerCompliance?: string;
  ultimaRevisaoCompliance?: string;
  procuradores?: Record<string, unknown>[];
  beneficiariosFinais?: Record<string, unknown>[];
};

export type DebtorInput = EntityInput & {
  nomeFantasia?: string;
  email?: string;
  telefone?: string;
  site?: string;
  endereco?: string;
  cidade?: string;
  uf?: string;
  contatoFinanceiroNome?: string;
  contatoFinanceiroCargo?: string;
  contatoFinanceiroEmail?: string;
  contatoFinanceiroTelefone?: string;
  emailConfirmacao?: string;
  telefoneConfirmacao?: string;
  canalConfirmacao?: string;
  janelaConfirmacao?: string;
  statusConfirmacao?: string;
  ultimaConfirmacao?: string;
  observacaoConfirmacao?: string;
  evidenciaRelacionamento?: string;
  historicoProtestos?: string;
  comportamentoPagamento?: string;
  observacoesOperacionais?: string;
};

const statuses = ["Ativo", "Em anÃ¡lise", "Monitorar", "Bloqueado", "Inativo"] as const;

export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function isValidCnpj(value: string) {
  const digits = onlyDigits(value);
  return digits.length === 14 && !/^(\d)\1+$/.test(digits);
}

export function parseEntityInput(input: unknown): { data?: EntityInput; error?: string } {
  const record = input as Partial<Record<keyof EntityInput, unknown>>;
  const nome = String(record.nome ?? "").trim();
  const doc = String(record.doc ?? "").trim();
  const extra = String(record.extra ?? "").trim();
  const valor = Number(record.valor ?? 0);
  const status = String(record.status ?? "Ativo") as EntityStatus;

  if (nome.length < 3) return { error: "RazÃ£o social deve ter ao menos 3 caracteres." };
  if (!doc) return { error: "CNPJ Ã© obrigatÃ³rio." };
  if (!isValidCnpj(doc)) return { error: "CNPJ invÃ¡lido." };
  if (!extra) return { error: "Campo complementar Ã© obrigatÃ³rio." };
  if (!Number.isFinite(valor) || valor < 0) return { error: "Valor deve ser maior ou igual a zero." };
  if (!statuses.includes(status as (typeof statuses)[number])) return { error: "Status invÃ¡lido." };

  return { data: { nome, doc, extra, valor, status } };
}

function optionalString(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalDate(value: unknown) {
  const text = optionalString(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : text;
}

function parseJsonField(value: unknown) {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  const text = optionalString(value);
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : undefined;
  } catch {
    return undefined;
  }
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function parseAssignorInput(input: unknown): { data?: AssignorInput; error?: string } {
  const base = parseEntityInput(input);
  if (base.error || !base.data) return base;
  const record = input as Record<string, unknown>;

  const email = optionalString(record.email);
  if (email && !isValidEmail(email)) return { error: "E-mail do cedente invÃ¡lido." };

  const uf = optionalString(record.uf)?.toUpperCase();
  if (uf && !/^[A-Z]{2}$/.test(uf)) return { error: "UF deve conter 2 letras." };

  return {
    data: {
      ...base.data,
      nomeFantasia: optionalString(record.nomeFantasia),
      inscricaoEstadual: optionalString(record.inscricaoEstadual),
      inscricaoMunicipal: optionalString(record.inscricaoMunicipal),
      fundacao: optionalDate(record.fundacao),
      site: optionalString(record.site),
      email,
      telefone: optionalString(record.telefone),
      endereco: optionalString(record.endereco),
      cidade: optionalString(record.cidade),
      uf,
      grupoEconomico: optionalString(record.grupoEconomico),
      receitaAnual: optionalNumber(record.receitaAnual),
      funcionarios: optionalNumber(record.funcionarios),
      gerenteRelacionamento: optionalString(record.gerenteRelacionamento),
      etapaOnboarding: optionalString(record.etapaOnboarding) ?? "Cadastro inicial",
      complianceStatus: optionalString(record.complianceStatus) ?? "Pendente",
      kycStatus: optionalString(record.kycStatus) ?? "Pendente",
      consultaSancoes: optionalString(record.consultaSancoes) ?? "NÃ£o consultado",
      exposicaoPep: optionalString(record.exposicaoPep) ?? "NÃ£o informado",
      parecerCompliance: optionalString(record.parecerCompliance),
      ultimaRevisaoCompliance: optionalDate(record.ultimaRevisaoCompliance),
      procuradores: parseJsonField(record.procuradores),
      beneficiariosFinais: parseJsonField(record.beneficiariosFinais),
    },
  };
}
export function parseDebtorInput(input: unknown): { data?: DebtorInput; error?: string } {
  const base = parseEntityInput(input);
  if (base.error || !base.data) return base;
  const record = input as Record<string, unknown>;

  const email = optionalString(record.email);
  const contatoFinanceiroEmail = optionalString(record.contatoFinanceiroEmail);
  const emailConfirmacao = optionalString(record.emailConfirmacao);
  if (email && !isValidEmail(email)) return { error: "E-mail do sacado invÃ¡lido." };
  if (contatoFinanceiroEmail && !isValidEmail(contatoFinanceiroEmail)) return { error: "E-mail do contato financeiro invÃ¡lido." };
  if (emailConfirmacao && !isValidEmail(emailConfirmacao)) return { error: "E-mail de confirmaÃ§Ã£o invÃ¡lido." };

  const uf = optionalString(record.uf)?.toUpperCase();
  if (uf && !/^[A-Z]{2}$/.test(uf)) return { error: "UF deve conter 2 letras." };

  return {
    data: {
      ...base.data,
      nomeFantasia: optionalString(record.nomeFantasia),
      email,
      telefone: optionalString(record.telefone),
      site: optionalString(record.site),
      endereco: optionalString(record.endereco),
      cidade: optionalString(record.cidade),
      uf,
      contatoFinanceiroNome: optionalString(record.contatoFinanceiroNome),
      contatoFinanceiroCargo: optionalString(record.contatoFinanceiroCargo),
      contatoFinanceiroEmail,
      contatoFinanceiroTelefone: optionalString(record.contatoFinanceiroTelefone),
      emailConfirmacao,
      telefoneConfirmacao: optionalString(record.telefoneConfirmacao),
      canalConfirmacao: optionalString(record.canalConfirmacao) ?? "E-mail",
      janelaConfirmacao: optionalString(record.janelaConfirmacao),
      statusConfirmacao: optionalString(record.statusConfirmacao) ?? "Pendente",
      ultimaConfirmacao: optionalDate(record.ultimaConfirmacao),
      observacaoConfirmacao: optionalString(record.observacaoConfirmacao),
      evidenciaRelacionamento: optionalString(record.evidenciaRelacionamento),
      historicoProtestos: optionalString(record.historicoProtestos),
      comportamentoPagamento: optionalString(record.comportamentoPagamento),
      observacoesOperacionais: optionalString(record.observacoesOperacionais),
    },
  };
}

