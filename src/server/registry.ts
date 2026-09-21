import type { Prisma, PrismaClient } from "@prisma/client";
import type { RegistryCheck } from "@/lib/types";
import { isValidCnpj, isValidCpf } from "@/lib/validation";
import { writeAudit } from "@/server/audit";

type RegistryEntityType = "Assignor" | "Debtor" | "Representative" | "BeneficialOwner";

export type RegistrySubject = {
  entityType: RegistryEntityType;
  entityId: string;
  declaredName: string;
  documentNumber: string;
};

type RegistryProviderResult = {
  provider: string;
  status: RegistryCheck["status"];
  registryStatus?: string | null;
  registryName?: string | null;
  nameMatch?: boolean | null;
  checkedAt?: Date | null;
  expiresAt?: Date | null;
  evidenceSource?: string | null;
  evidenceDocumentId?: string | null;
  evidenceDocumentCode?: string | null;
  raw?: unknown;
  notes?: string | null;
};

const cnpjBlockedStatuses = ["INAPTA", "SUSPENSA", "BAIXADA", "NULA", "CANCELADA"];
const cpfBlockedStatuses = ["TITULAR FALECIDO", "FALECIDO", "CANCELADA", "CANCELADO", "NULA", "SUSPENSA"];

export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function documentTypeFor(value: string) {
  const digits = onlyDigits(value);
  if (digits.length === 14) return "CNPJ";
  if (digits.length === 11) return "CPF";
  return "Documento";
}

function normalizeText(value?: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .toUpperCase();
}

function evaluateStatus(documentType: string, registryStatus?: string | null, nameMatch?: boolean | null): RegistryCheck["status"] {
  const normalized = normalizeText(registryStatus);
  if (!registryStatus) return "Pendente";
  if (documentType === "CNPJ" && cnpjBlockedStatuses.some((status) => normalized.includes(status))) return "Bloqueado";
  if (documentType === "CPF" && cpfBlockedStatuses.some((status) => normalized.includes(status))) return "Bloqueado";
  if (documentType === "CNPJ" && normalized.includes("ATIVA") && nameMatch !== false) return "Regular";
  if (documentType === "CPF" && normalized.includes("REGULAR") && nameMatch !== false) return "Regular";
  if (nameMatch === false) return "Atenção";
  return "Atenção";
}

export function compareRegistryName(declaredName: string, registryName?: string | null) {
  const declared = normalizeText(declaredName);
  const registry = normalizeText(registryName);
  if (!registry) return null;
  return declared === registry || declared.includes(registry) || registry.includes(declared);
}

export function evaluateManualRegistryCheck(subject: RegistrySubject, input: { registryStatus?: string; registryName?: string; notes?: string; checkedAt?: Date | null; expiresAt?: Date | null; evidenceSource?: string | null; evidenceDocumentId?: string | null; evidenceDocumentCode?: string | null }): RegistryProviderResult {
  const documentType = documentTypeFor(subject.documentNumber);
  const nameMatch = compareRegistryName(subject.declaredName, input.registryName);
  const status = evaluateStatus(documentType, input.registryStatus, nameMatch);
  const checkedAt = input.checkedAt ?? new Date();

  return {
    provider: "MANUAL",
    status,
    registryStatus: input.registryStatus?.trim() || null,
    registryName: input.registryName?.trim() || null,
    nameMatch,
    checkedAt,
    expiresAt: input.expiresAt ?? new Date(checkedAt.getTime() + 1000 * 60 * 60 * 24 * 30),
    evidenceSource: input.evidenceSource ?? null,
    evidenceDocumentId: input.evidenceDocumentId ?? null,
    evidenceDocumentCode: input.evidenceDocumentCode ?? null,
    raw: { mode: "manual", nameMatch, evidenceDocumentCode: input.evidenceDocumentCode ?? null },
    notes: input.notes?.trim() || "Resultado informado manualmente pela equipe de cadastro/compliance.",
  };
}

function pickString(value: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    let current: unknown = value;
    for (const key of path) {
      if (!current || typeof current !== "object" || !(key in current)) {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[key];
    }
    if (typeof current === "string" && current.trim()) return current.trim();
    if (typeof current === "number") return String(current);
  }
  return null;
}

async function consultPublicCnpj(subject: RegistrySubject): Promise<RegistryProviderResult> {
  const documentNumber = onlyDigits(subject.documentNumber);
  if (!isValidCnpj(documentNumber)) {
    return {
      provider: "VALIDACAO_LOCAL",
      status: "Bloqueado",
      registryStatus: "CNPJ inválido",
      registryName: null,
      nameMatch: null,
      checkedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      raw: { reason: "invalid_cnpj_checksum" },
      notes: "CNPJ reprovado na validação dos dígitos verificadores.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${documentNumber}`, {
      headers: { Accept: "application/json", "User-Agent": "HOAM-Warehouse/1.0" },
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        provider: "BRASILAPI",
        status: response.status === 404 ? "Atenção" : "Erro",
        checkedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        raw: payload ?? { status: response.status },
        notes: `Triagem pública de CNPJ retornou HTTP ${response.status}. A validação oficial SERPRO continua obrigatória.`,
      };
    }

    const registryStatus = pickString(payload, [["descricao_situacao_cadastral"], ["situacao_cadastral"]]);
    const registryName = pickString(payload, [["razao_social"], ["nome_fantasia"]]);
    const nameMatch = compareRegistryName(subject.declaredName, registryName);
    const evaluated = evaluateStatus("CNPJ", registryStatus, nameMatch);
    return {
      provider: "BRASILAPI",
      status: evaluated === "Bloqueado" ? "Bloqueado" : "Atenção",
      registryStatus,
      registryName,
      nameMatch,
      checkedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      evidenceSource: `https://brasilapi.com.br/api/cnpj/v1/${documentNumber}`,
      raw: { payload, sourceClass: "public_screening" },
      notes: evaluated === "Bloqueado"
        ? "Situação impeditiva encontrada na triagem pública. Exige bloqueio e confirmação na base oficial."
        : "Triagem automática em dados públicos concluída. Não substitui a validação oficial Receita/SERPRO.",
    };
  } catch (error) {
    return {
      provider: "BRASILAPI",
      status: "Erro",
      checkedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 6),
      raw: { reason: error instanceof Error ? error.message : "public_cnpj_lookup_failed" },
      notes: "Não foi possível concluir a triagem automática de CNPJ. Tente novamente ou registre evidência oficial manual.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function consultOfficialRegistry(subject: RegistrySubject): Promise<RegistryProviderResult> {
  const documentType = documentTypeFor(subject.documentNumber);
  const baseUrl =
    documentType === "CNPJ"
      ? process.env.SERPRO_CNPJ_BASE_URL
      : documentType === "CPF"
        ? process.env.SERPRO_CPF_BASE_URL
        : undefined;
  const token = process.env.SERPRO_ACCESS_TOKEN;

  if (!baseUrl || !token || documentType === "Documento") {
    if (documentType === "CNPJ") return consultPublicCnpj(subject);
    if (documentType === "CPF") {
      const valid = isValidCpf(subject.documentNumber);
      return {
        provider: "VALIDACAO_LOCAL",
        status: valid ? "Pendente" : "Bloqueado",
        registryStatus: valid ? "CPF estruturalmente válido" : "CPF inválido",
        registryName: null,
        nameMatch: null,
        checkedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
        raw: { reason: valid ? "serpro_credentials_required" : "invalid_cpf_checksum", documentType },
        notes: valid
          ? "CPF validado estruturalmente. Situação cadastral e eventual titular falecido exigem a API oficial SERPRO/Receita."
          : "CPF reprovado na validação dos dígitos verificadores.",
      };
    }
    return {
      provider: "UNCONFIGURED",
      status: "Pendente",
      registryStatus: null,
    registryName: null,
      nameMatch: null,
      checkedAt: null,
      expiresAt: null,
      raw: { reason: "missing_serpro_credentials", documentType },
      notes: "Configure SERPRO_ACCESS_TOKEN e a URL oficial da API SERPRO/Receita para automatizar esta consulta. Até lá, registre a validação manual.",
    };
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/${onlyDigits(subject.documentNumber)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      provider: "SERPRO",
      status: "Erro",
      raw: payload ?? { status: response.status },
      notes: `Consulta SERPRO retornou HTTP ${response.status}.`,
    };
  }

  const registryStatus = pickString(payload, [
    ["situacaoCadastral", "descricao"],
    ["situacao_cadastral"],
    ["situacao", "descricao"],
    ["situacao"],
    ["status"],
  ]);
  const registryName = pickString(payload, [
    ["nomeEmpresarial"],
    ["razao_social"],
    ["nome"],
    ["nomeContribuinte"],
    ["contribuinte", "nome"],
  ]);
  const nameMatch = compareRegistryName(subject.declaredName, registryName);

  return {
    provider: "SERPRO",
    status: evaluateStatus(documentType, registryStatus, nameMatch),
    registryStatus,
    registryName,
    nameMatch,
    checkedAt: new Date(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    raw: { payload, nameMatch },
    notes: nameMatch === false ? "Nome cadastrado diverge do nome retornado pela base oficial." : null,
  };
}

type RegistryDb = PrismaClient | Prisma.TransactionClient;

export async function createAutomaticRegistryCheck(
  db: RegistryDb,
  subject: RegistrySubject,
  userId?: string | null,
  options: { force?: boolean } = {},
) {
  const now = new Date();
  if (!options.force) {
    const fresh = await db.registryCheck.findFirst({
      where: {
        entityType: subject.entityType,
        entityId: subject.entityId,
        deletedAt: null,
        expiresAt: { gt: now },
        provider: { not: "UNCONFIGURED" },
      },
      orderBy: { createdAt: "desc" },
    });
    if (fresh) return fresh;
  }

  const result = await consultOfficialRegistry(subject);
  const check = await db.registryCheck.create({
    data: {
      entityType: subject.entityType,
      entityId: subject.entityId,
      documentType: documentTypeFor(subject.documentNumber),
      documentNumber: onlyDigits(subject.documentNumber),
      provider: result.provider,
      status: result.status,
      registryStatus: result.registryStatus,
      registryName: result.registryName,
      declaredName: subject.declaredName,
      nameMatch: result.nameMatch ?? compareRegistryName(subject.declaredName, result.registryName),
      checkedAt: result.checkedAt ?? undefined,
      expiresAt: result.expiresAt ?? undefined,
      evidenceSource: result.evidenceSource,
      evidenceDocumentId: result.evidenceDocumentId,
      raw: result.raw as Prisma.InputJsonValue,
      notes: result.notes,
      createdById: userId ?? undefined,
    },
  });

  await writeAudit(db, {
    action: "REGISTRY_CHECK_AUTOMATED",
    entityType: subject.entityType,
    entityId: subject.entityId,
    userId,
    after: {
      id: check.id,
      documentType: check.documentType,
      provider: check.provider,
      status: check.status,
      registryStatus: check.registryStatus,
      nameMatch: check.nameMatch,
      checkedAt: check.checkedAt,
      expiresAt: check.expiresAt,
    },
  });

  return check;
}

export function mapRegistryCheck(item: {
  id: string;
  entityType: string;
  entityId: string;
  documentType: string;
  documentNumber: string;
  provider: string;
  status: string;
  registryStatus?: string | null;
  registryName?: string | null;
  declaredName?: string | null;
  nameMatch?: boolean | null;
  checkedAt?: Date | null;
  expiresAt?: Date | null;
  evidenceSource?: string | null;
  evidenceDocumentId?: string | null;
  evidenceDocument?: { code: string } | null;
  notes?: string | null;
  createdAt: Date;
}): RegistryCheck {
  return {
    id: item.id,
    entityType: item.entityType,
    entityId: item.entityId,
    documentType: item.documentType,
    documentNumber: item.documentNumber,
    provider: item.provider,
    status: item.status as RegistryCheck["status"],
    registryStatus: item.registryStatus ?? null,
    registryName: item.registryName ?? null,
    declaredName: item.declaredName ?? null,
    nameMatch: item.nameMatch ?? null,
    checkedAt: item.checkedAt?.toISOString() ?? null,
    expiresAt: item.expiresAt?.toISOString() ?? null,
    evidenceSource: item.evidenceSource ?? null,
    evidenceDocumentId: item.evidenceDocumentId ?? null,
    evidenceDocumentCode: item.evidenceDocument?.code ?? null,
    notes: item.notes ?? null,
    createdAt: item.createdAt.toISOString(),
  };
}
