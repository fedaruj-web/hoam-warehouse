import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import {
  compareRegistryName,
  consultOfficialRegistry,
  documentTypeFor,
  evaluateManualRegistryCheck,
  mapRegistryCheck,
  onlyDigits,
} from "@/server/registry";

type RegistryEntityType = "Assignor" | "Debtor" | "Representative" | "BeneficialOwner";

type RegistryRequest = {
  entityType?: RegistryEntityType;
  entityId?: string;
  mode?: "official" | "manual";
  documentNumber?: string;
  declaredName?: string;
  registryStatus?: string;
  registryName?: string;
  notes?: string;
};

function moduleFor(entityType: RegistryEntityType) {
  return entityType === "Debtor" ? "Sacados" : "Cedentes";
}

function isSupportedEntityType(value: unknown): value is RegistryEntityType {
  return ["Assignor", "Debtor", "Representative", "BeneficialOwner"].includes(String(value));
}

function subjectsFromJson(entityType: RegistryEntityType, entityId: string, value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const documentNumber = typeof row.cpf === "string" ? row.cpf : "";
      const declaredName = typeof row.nome === "string" ? row.nome : "";
      if (!onlyDigits(documentNumber) || !declaredName.trim()) return null;
      return {
        entityType,
        entityId: `${entityId}:${entityType === "Representative" ? "REP" : "UBO"}-${index + 1}`,
        documentNumber,
        declaredName,
      };
    })
    .filter(Boolean) as { entityType: RegistryEntityType; entityId: string; documentNumber: string; declaredName: string }[];
}

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Cedentes", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json([]);

  const checks = await db.registryCheck.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return NextResponse.json(checks.map(mapRegistryCheck));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as RegistryRequest | null;
  if (!body || !isSupportedEntityType(body.entityType) || !body.entityId) {
    return NextResponse.json({ error: "Informe entityType e entityId para consultar a base cadastral." }, { status: 400 });
  }

  const db = getDbOrNull();
  const auth = await requirePermission(db, moduleFor(body.entityType), "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco de dados indisponível para registrar a consulta." }, { status: 503 });

  const baseSubjects = [];
  if (body.entityType === "Assignor") {
    const assignor = await db.assignor.findUnique({ where: { code: body.entityId } });
    if (!assignor || assignor.deletedAt) return NextResponse.json({ error: "Cedente não encontrado." }, { status: 404 });
    baseSubjects.push({
      entityType: "Assignor" as const,
      entityId: assignor.code,
      documentNumber: assignor.taxId,
      declaredName: assignor.legalName,
    });
    if (body.mode !== "manual") {
      baseSubjects.push(...subjectsFromJson("Representative", assignor.code, assignor.representatives));
      baseSubjects.push(...subjectsFromJson("BeneficialOwner", assignor.code, assignor.ultimateBeneficialOwners));
    }
  } else if (body.entityType === "Debtor") {
    const debtor = await db.debtor.findUnique({ where: { code: body.entityId } });
    if (!debtor || debtor.deletedAt) return NextResponse.json({ error: "Sacado não encontrado." }, { status: 404 });
    baseSubjects.push({
      entityType: "Debtor" as const,
      entityId: debtor.code,
      documentNumber: debtor.taxId,
      declaredName: debtor.legalName,
    });
  } else {
    if (!body.documentNumber || !body.declaredName) {
      return NextResponse.json({ error: "CPF e nome são obrigatórios para consultar procuradores/beneficiários." }, { status: 400 });
    }
    baseSubjects.push({
      entityType: body.entityType,
      entityId: body.entityId,
      documentNumber: body.documentNumber,
      declaredName: body.declaredName,
    });
  }

  const created = [];
  for (const subject of baseSubjects) {
    const result =
      body.mode === "manual"
        ? evaluateManualRegistryCheck(subject, {
            registryStatus: body.registryStatus,
            registryName: body.registryName,
            notes: body.notes,
          })
        : await consultOfficialRegistry(subject);

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
        raw: result.raw as Prisma.InputJsonValue,
        notes: result.notes,
        createdById: auth.user.id,
      },
    });
    created.push(check);
  }

  await writeAudit(db, {
    action: "REGISTRY_CHECK_CREATED",
    entityType: body.entityType,
    entityId: body.entityId,
    userId: auth.user.id,
    after: created,
  });

  return NextResponse.json(created.map(mapRegistryCheck), { status: 201 });
}
