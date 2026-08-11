import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { DOCUMENT_BUCKET, ensureDocumentBucket, getStorageClient } from "@/server/storage";
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
  checkedAt?: string;
  expiresAt?: string;
  evidenceSource?: string;
};

function nextDocumentCode(count: number) {
  return `DOC-${String(count + 1).padStart(4, "0")}`;
}

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

function toDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function parseRegistryRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return { body: null, file: null as File | null };
    const body: RegistryRequest = {
      entityType: String(form.get("entityType") ?? "") as RegistryEntityType,
      entityId: String(form.get("entityId") ?? ""),
      mode: String(form.get("mode") ?? "manual") as "manual" | "official",
      documentNumber: String(form.get("documentNumber") ?? ""),
      declaredName: String(form.get("declaredName") ?? ""),
      registryStatus: String(form.get("registryStatus") ?? ""),
      registryName: String(form.get("registryName") ?? ""),
      notes: String(form.get("notes") ?? ""),
      checkedAt: String(form.get("checkedAt") ?? ""),
      expiresAt: String(form.get("expiresAt") ?? ""),
      evidenceSource: String(form.get("evidenceSource") ?? ""),
    };
    const file = form.get("evidenceFile");
    return { body, file: file instanceof File && file.size > 0 ? file : null };
  }

  return { body: (await request.json().catch(() => null)) as RegistryRequest | null, file: null as File | null };
}

async function createEvidenceDocument({
  assignorId,
  debtorId,
  authUserId,
  db,
  entityCode,
  file,
  source,
  validUntil,
}: {
  assignorId?: string;
  debtorId?: string;
  authUserId: string;
  db: NonNullable<ReturnType<typeof getDbOrNull>>;
  entityCode: string;
  file: File | null;
  source?: string | null;
  validUntil?: Date | null;
}) {
  if (!file) return null;

  const storage = getStorageClient();
  if (!storage) {
    throw new Error("Storage não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para anexar evidências.");
  }

  const code = nextDocumentCode(await db.document.count());
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const storageKey = `${code}/${Date.now()}-${safeName}`;
  await ensureDocumentBucket(storage);
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error } = await storage.storage.from(DOCUMENT_BUCKET).upload(storageKey, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(error.message);

  const document = await db.document.create({
    data: {
      code,
      name: `Evidência Receita - ${entityCode}`,
      type: "KYC",
      status: "VALID",
      stage: "Cadastro",
      requirement: "CONSULTA_RECEITA",
      storageKey,
      sizeBytes: file.size,
      expiresAt: validUntil ?? null,
      assignorId,
      debtorId,
      uploadedById: authUserId,
    },
  });

  await writeAudit(db, {
    action: "REGISTRY_EVIDENCE_UPLOADED",
    entityType: "Document",
    entityId: document.code,
    userId: authUserId,
    after: { document, source, bucket: DOCUMENT_BUCKET, storageKey },
  });

  return document;
}

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Cedentes", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json([]);

  const checks = await db.registryCheck.findMany({
    where: { deletedAt: null },
    include: { evidenceDocument: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return NextResponse.json(checks.map(mapRegistryCheck));
}

export async function POST(request: Request) {
  const { body, file } = await parseRegistryRequest(request);
  if (!body || !isSupportedEntityType(body.entityType) || !body.entityId) {
    return NextResponse.json({ error: "Informe entityType e entityId para consultar a base cadastral." }, { status: 400 });
  }

  const db = getDbOrNull();
  const auth = await requirePermission(db, moduleFor(body.entityType), "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco de dados indisponível para registrar a consulta." }, { status: 503 });

  const baseSubjects = [];
  let evidenceAssignorId: string | undefined;
  let evidenceDebtorId: string | undefined;
  if (body.entityType === "Assignor") {
    const assignor = await db.assignor.findUnique({ where: { code: body.entityId } });
    if (!assignor || assignor.deletedAt) return NextResponse.json({ error: "Cedente não encontrado." }, { status: 404 });
    evidenceAssignorId = assignor.id;
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
    evidenceDebtorId = debtor.id;
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

  const checkedAt = toDate(body.checkedAt) ?? new Date();
  const expiresAt = toDate(body.expiresAt) ?? new Date(checkedAt.getTime() + 1000 * 60 * 60 * 24 * 30);
  let evidenceDocument = null;
  try {
    evidenceDocument = body.mode === "manual"
      ? await createEvidenceDocument({
          assignorId: evidenceAssignorId,
          debtorId: evidenceDebtorId,
          authUserId: auth.user.id,
          db,
          entityCode: body.entityId,
          file,
          source: body.evidenceSource,
          validUntil: expiresAt,
        })
      : null;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível anexar a evidência." }, { status: 502 });
  }

  const created = [];
  for (const subject of baseSubjects) {
    const result =
      body.mode === "manual"
        ? evaluateManualRegistryCheck(subject, {
            registryStatus: body.registryStatus,
            registryName: body.registryName,
            notes: body.notes,
            checkedAt,
            expiresAt,
            evidenceSource: body.evidenceSource,
            evidenceDocumentId: evidenceDocument?.id,
            evidenceDocumentCode: evidenceDocument?.code,
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
        evidenceSource: result.evidenceSource,
        evidenceDocumentId: result.evidenceDocumentId,
        raw: result.raw as Prisma.InputJsonValue,
        notes: result.notes,
        createdById: auth.user.id,
      },
      include: { evidenceDocument: true },
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
