import { createHash } from "crypto";
import type { DocumentStatus, DocumentType } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { documentStatusToPrisma, documentTypeToPrisma, mapAssignor, mapDocument } from "@/server/entities";

function nextDocumentCode(count: number) {
  return `DOC-${String(count + 1).padStart(4, "0")}`;
}

function safeStorageName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function storageConfig() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_DOCUMENTS_BUCKET ?? "hoam-documents";
  if (!url || !serviceRoleKey) return null;
  return { url: url.replace(/\/$/, ""), serviceRoleKey, bucket };
}

async function uploadToSupabaseStorage(path: string, file: File) {
  const config = storageConfig();
  if (!config) return { storageKey: path, storageMode: "METADATA_ONLY" as const };

  const upload = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.serviceRoleKey}`,
      apikey: config.serviceRoleKey,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "false",
    },
    body: await file.arrayBuffer(),
  });

  if (!upload.ok) {
    const detail = await upload.text().catch(() => "");
    return { storageKey: path, storageMode: "UPLOAD_FAILED" as const, storageError: detail.slice(0, 300) };
  }

  return { storageKey: `${config.bucket}/${path}`, storageMode: "STORAGE" as const };
}

function documentPayload(input: unknown, file?: File | null) {
  const record = input as Record<string, unknown>;
  const name = String(record?.name ?? file?.name ?? "").trim();
  const type = String(record?.type ?? "KYC").trim();
  const stage = String(record?.stage ?? "Cadastro").trim();
  const requirement = String(record?.requirement ?? "KYC_CEDENTE").trim();
  const notes = String(record?.notes ?? "").trim();
  const sizeBytes = Number(record?.sizeBytes ?? file?.size ?? 0);
  const expiresAtInput = String(record?.expiresAt ?? "").trim();

  if (name.length < 3) return { error: "Informe um nome de documento com ao menos 3 caracteres." };
  if (!documentTypeToPrisma[type]) return { error: "Tipo de documento invalido." };
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return { error: "Tamanho invalido." };

  const expiresAt = expiresAtInput ? new Date(expiresAtInput) : null;
  if (expiresAtInput && Number.isNaN(expiresAt?.getTime())) return { error: "Vencimento invalido." };

  return {
    data: {
      name,
      type: documentTypeToPrisma[type] as DocumentType,
      status: documentStatusToPrisma["Em revisão"] as DocumentStatus,
      stage: stage || "Cadastro",
      requirement: requirement || "KYC_CEDENTE",
      notes,
      sizeBytes: sizeBytes || null,
      expiresAt,
      fileName: file?.name ?? null,
    },
  };
}

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Documentos", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Portal do cedente exige banco de dados ativo." }, { status: 503 });
  if (!auth.user.assignorId) return NextResponse.json({ error: "Usuario nao esta vinculado a um cedente." }, { status: 403 });

  const [assignor, documents, receivables, termAudits] = await Promise.all([
    db.assignor.findUnique({
      where: { id: auth.user.assignorId },
      include: { portalUsers: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } } },
    }),
    db.document.findMany({
      where: { assignorId: auth.user.assignorId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    db.receivable.findMany({
      where: { assignorId: auth.user.assignorId, deletedAt: null },
      select: { id: true, externalId: true, status: true },
    }),
    db.auditLog.findMany({
      where: { action: "ASSIGNOR_PORTAL_TERMS_ACCEPTED", userId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  if (!assignor || assignor.deletedAt) return NextResponse.json({ error: "Cedente nao encontrado." }, { status: 404 });

  const required = [
    { requirement: "CONTRATO_CESSAO", label: "Contrato de cessao / master agreement", type: "Contrato" },
    { requirement: "KYC_CEDENTE", label: "Documentos cadastrais e KYC", type: "KYC" },
    { requirement: "PROCURACAO", label: "Procuracao / poderes dos representantes", type: "Procuração" },
    { requirement: "TERMOS_OPERACIONAIS", label: "Termos operacionais e ciencia de regras", type: "Contrato" },
  ];
  const completed = new Set(documents.filter((doc) => doc.status === "VALID" || doc.status === "REVIEW").map((doc) => doc.requirement));

  return NextResponse.json({
    user: {
      id: auth.user.id,
      name: auth.user.name,
      email: auth.user.email,
      status: auth.user.status,
    },
    assignor: mapAssignor(assignor),
    documents: documents.map((document) => mapDocument(document, assignor.legalName)),
    checklist: required.map((item) => ({
      ...item,
      status: completed.has(item.requirement) ? "Recebido / em analise" : "Pendente",
      pending: !completed.has(item.requirement),
    })),
    acceptedTerms: termAudits.map((audit) => {
      const after = audit.after && typeof audit.after === "object" ? audit.after as Record<string, unknown> : {};
      return {
        id: audit.id,
        term: String(after.term ?? "Termo operacional"),
        acceptedAt: audit.createdAt.toLocaleString("pt-BR"),
        evidenceHash: after.evidenceHash ? String(after.evidenceHash) : null,
      };
    }),
    summary: {
      receivables: receivables.length,
      documents: documents.length,
      pending: required.filter((item) => !completed.has(item.requirement)).length,
      inReview: documents.filter((doc) => doc.status === "REVIEW").length,
      acceptedTerms: termAudits.length,
      storageConfigured: Boolean(storageConfig()),
    },
  });
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Documentos", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Portal do cedente exige banco de dados ativo." }, { status: 503 });
  if (!auth.user.assignorId) return NextResponse.json({ error: "Usuario nao esta vinculado a um cedente." }, { status: 403 });

  const contentType = request.headers.get("content-type") ?? "";
  let payload: Record<string, unknown> = {};
  let file: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    file = form.get("file") instanceof File ? form.get("file") as File : null;
    payload = Object.fromEntries(form.entries().filter(([, value]) => typeof value === "string"));
  } else {
    payload = await request.json().catch(() => null) ?? {};
  }

  const assignor = await db.assignor.findUnique({ where: { id: auth.user.assignorId } });
  if (!assignor || assignor.deletedAt) return NextResponse.json({ error: "Cedente nao encontrado." }, { status: 404 });

  if (payload.action === "accept_terms") {
    const term = String(payload.term ?? "Termos operacionais do portal HOAM").trim();
    const signerName = String(payload.signerName ?? auth.user.name).trim();
    const signerDocument = String(payload.signerDocument ?? "").trim();
    const evidence = JSON.stringify({
      assignor: assignor.code,
      userId: auth.user.id,
      userEmail: auth.user.email,
      term,
      signerName,
      signerDocument,
      acceptedAt: new Date().toISOString(),
    });
    const evidenceHash = createHash("sha256").update(evidence).digest("hex");

    await writeAudit(db, {
      action: "ASSIGNOR_PORTAL_TERMS_ACCEPTED",
      entityType: "Assignor",
      entityId: assignor.code,
      userId: auth.user.id,
      after: { term, signerName, signerDocument, evidenceHash },
    });

    return NextResponse.json({ ok: true, term, evidenceHash });
  }

  const parsed = documentPayload(payload, file);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.data) return NextResponse.json({ error: "Dados invalidos." }, { status: 400 });

  const code = nextDocumentCode(await db.document.count());
  const fileName = parsed.data.fileName ?? parsed.data.name;
  const storagePath = `assignor-portal/${assignor.code}/${code}/${safeStorageName(fileName)}`;
  const storage = file ? await uploadToSupabaseStorage(storagePath, file) : { storageKey: storagePath, storageMode: "METADATA_ONLY" as const };

  const created = await db.document.create({
    data: {
      code,
      name: parsed.data.name,
      type: parsed.data.type,
      status: parsed.data.status,
      stage: parsed.data.stage,
      requirement: parsed.data.requirement,
      storageKey: storage.storageKey,
      sizeBytes: parsed.data.sizeBytes,
      expiresAt: parsed.data.expiresAt,
      assignorId: assignor.id,
      uploadedById: auth.user.id,
    },
  });

  await writeAudit(db, {
    action: "ASSIGNOR_PORTAL_DOCUMENT_SUBMITTED",
    entityType: "Document",
    entityId: created.code,
    userId: auth.user.id,
    after: { document: created, assignor: assignor.code, notes: parsed.data.notes, storage },
  });

  return NextResponse.json({ ...mapDocument(created, assignor.legalName), storageMode: storage.storageMode }, { status: 201 });
}
