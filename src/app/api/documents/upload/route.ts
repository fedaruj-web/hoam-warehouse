import { NextResponse } from "next/server";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapDocument } from "@/server/entities";
import { DOCUMENT_BUCKET, ensureDocumentBucket, getStorageClient } from "@/server/storage";

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Documentos", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const documentId = String(form?.get("documentId") ?? "").trim();
  const file = form?.get("file");
  if (!documentId) return NextResponse.json({ error: "Documento não informado." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });

  const storage = getStorageClient();
  if (!storage) return NextResponse.json({ error: "Storage não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const document = await db.document.findUnique({ where: { code: documentId }, include: { receivable: true, purchase: true } });
  if (!document || document.deletedAt) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });

  await ensureDocumentBucket(storage);
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const storageKey = `${document.code}/${Date.now()}-${safeName}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error } = await storage.storage.from(DOCUMENT_BUCKET).upload(storageKey, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  const updated = await db.document.update({
    where: { id: document.id },
    data: {
      storageKey,
      sizeBytes: file.size,
      status: "VALID",
    },
    include: { receivable: true, purchase: true },
  });

  await writeAudit(db, {
    action: "DOCUMENT_FILE_UPLOADED",
    entityType: "Document",
    entityId: updated.code,
    userId: auth.user.id,
    before: document,
    after: { document: updated, bucket: DOCUMENT_BUCKET, storageKey },
  });

  return NextResponse.json(mapDocument(updated));
}
