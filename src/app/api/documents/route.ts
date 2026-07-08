import type { DocumentStatus, DocumentType, PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { documentsSeed } from "@/lib/mock-data";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { documentStatusToPrisma, documentTypeToPrisma, mapDocument } from "@/server/entities";

function nextDocumentCode(count: number) {
  return `DOC-${String(count + 1).padStart(4, "0")}`;
}

function parseInput(input: unknown) {
  const record = input as Record<string, unknown>;
  const name = String(record?.name ?? record?.nome ?? "").trim();
  const type = String(record?.type ?? record?.tipo ?? "Comprovante").trim();
  const entity = String(record?.entity ?? "").trim();
  const status = String(record?.status ?? "Em revisão").trim();
  const stage = String(record?.stage ?? record?.etapa ?? "").trim();
  const requirement = String(record?.requirement ?? record?.requisito ?? "").trim();
  const expiresAtInput = String(record?.expiresAt ?? record?.vencimento ?? "").trim();
  const sizeBytes = Number(record?.sizeBytes ?? 0);

  if (name.length < 3) return { error: "Nome do documento deve ter ao menos 3 caracteres." };
  if (!documentTypeToPrisma[type]) return { error: "Tipo de documento inválido." };
  if (!documentStatusToPrisma[status]) return { error: "Status documental inválido." };
  if (!entity) return { error: "Vínculo operacional é obrigatório." };
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return { error: "Tamanho inválido." };
  const expiresAt = expiresAtInput ? new Date(expiresAtInput) : null;
  if (expiresAtInput && Number.isNaN(expiresAt?.getTime())) return { error: "Vencimento inválido." };

  return {
    data: {
      name,
      type: documentTypeToPrisma[type] as DocumentType,
      entity,
      status: documentStatusToPrisma[status] as DocumentStatus,
      stage: stage || null,
      requirement: requirement || null,
      expiresAt,
      sizeBytes: sizeBytes || null,
    },
  };
}

async function resolveEntity(db: PrismaClient, entity: string) {
  const [assignor, debtor, receivable, purchase] = await Promise.all([
    db.assignor.findFirst({ where: { OR: [{ code: entity }, { legalName: entity }], deletedAt: null } }),
    db.debtor.findFirst({ where: { OR: [{ code: entity }, { legalName: entity }], deletedAt: null } }),
    db.receivable.findFirst({ where: { externalId: entity, deletedAt: null } }),
    db.purchase.findFirst({ where: { code: entity, deletedAt: null } }),
  ]);

  return {
    assignor,
    debtor,
    receivable,
    purchase,
    label: assignor?.legalName ?? debtor?.legalName ?? receivable?.externalId ?? purchase?.code ?? entity,
  };
}

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Documentos", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json(documentsSeed);

  const documents = await db.document.findMany({
    where: { deletedAt: null },
    include: { receivable: true, purchase: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(documents.map((document) => mapDocument(document)));
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Documentos", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = parseInput(await request.json().catch(() => null));
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.data) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });

  if (!db) {
    return NextResponse.json({
      id: nextDocumentCode(documentsSeed.length),
      name: parsed.data.name,
      type: "Comprovante",
      entity: parsed.data.entity,
      status: "Em revisão",
      stage: parsed.data.stage,
      requirement: parsed.data.requirement,
      expiresAt: parsed.data.expiresAt?.toISOString() ?? null,
      uploadedAt: new Date().toISOString(),
      size: "Metadado",
    });
  }

  const code = nextDocumentCode(await db.document.count());
  const entity = await resolveEntity(db, parsed.data.entity);
  const created = await db.document.create({
    data: {
      code,
      name: parsed.data.name,
      type: parsed.data.type,
      status: parsed.data.status,
      stage: parsed.data.stage,
      requirement: parsed.data.requirement,
      storageKey: `hoam-documents/${code}/${parsed.data.name}`,
      sizeBytes: parsed.data.sizeBytes,
      expiresAt: parsed.data.expiresAt,
      assignorId: entity.assignor?.id,
      debtorId: entity.debtor?.id,
      receivableId: entity.receivable?.id,
      purchaseId: entity.purchase?.id,
      uploadedById: auth.user.id,
    },
    include: { receivable: true, purchase: true },
  });

  await writeAudit(db, {
    action: "DOCUMENT_REGISTERED",
    entityType: "Document",
    entityId: created.code,
    userId: auth.user.id,
    after: { document: created, entity: entity.label },
  });

  return NextResponse.json(mapDocument(created, entity.label), { status: 201 });
}

