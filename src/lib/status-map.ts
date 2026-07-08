import type { EntityStatus } from "./types";

type PrismaEntityStatus = "ACTIVE" | "REVIEW" | "BLOCKED" | "INACTIVE";

const toUi: Record<PrismaEntityStatus, EntityStatus> = {
  ACTIVE: "Ativo",
  REVIEW: "Em análise",
  BLOCKED: "Bloqueado",
  INACTIVE: "Inativo",
};

const toPrisma: Record<EntityStatus, PrismaEntityStatus> = {
  Ativo: "ACTIVE",
  "Em análise": "REVIEW",
  Monitorar: "REVIEW",
  Bloqueado: "BLOCKED",
  Inativo: "INACTIVE",
};

export function entityStatusToUi(status: string): EntityStatus {
  return toUi[status as PrismaEntityStatus] ?? "Em análise";
}

export function entityStatusToPrisma(status: string): PrismaEntityStatus {
  return toPrisma[status as EntityStatus] ?? "REVIEW";
}

