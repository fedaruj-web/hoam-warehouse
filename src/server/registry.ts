import type { RegistryCheck } from "@/lib/types";

type RegistryEntityType = "Assignor" | "Debtor" | "Representative" | "BeneficialOwner";

type RegistrySubject = {
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

export function evaluateManualRegistryCheck(subject: RegistrySubject, input: { registryStatus?: string; registryName?: string; notes?: string }): RegistryProviderResult {
  const documentType = documentTypeFor(subject.documentNumber);
  const nameMatch = compareRegistryName(subject.declaredName, input.registryName);
  const status = evaluateStatus(documentType, input.registryStatus, nameMatch);

  return {
    provider: "MANUAL",
    status,
    registryStatus: input.registryStatus?.trim() || null,
    registryName: input.registryName?.trim() || null,
    nameMatch,
    checkedAt: new Date(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    raw: { mode: "manual", nameMatch },
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
    notes: item.notes ?? null,
    createdAt: item.createdAt.toISOString(),
  };
}
