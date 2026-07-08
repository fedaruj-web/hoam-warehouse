import { NextResponse } from "next/server";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { DOCUMENT_BUCKET, getStorageClient } from "@/server/storage";

export async function GET(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Documentos", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const { searchParams } = new URL(request.url);
  const id = String(searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "Documento não informado." }, { status: 400 });

  const document = await db.document.findFirst({ where: { code: id, deletedAt: null } });
  if (!document) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  if (!document.storageKey) return NextResponse.json({ error: "Documento ainda não possui arquivo no storage." }, { status: 404 });

  const storage = getStorageClient();
  if (!storage) return NextResponse.json({ error: "Storage não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const { data, error } = await storage.storage.from(DOCUMENT_BUCKET).createSignedUrl(document.storageKey, 60 * 10);
  if (error || !data?.signedUrl) return NextResponse.json({ error: error?.message ?? "Não foi possível gerar link assinado." }, { status: 502 });

  return NextResponse.json({ url: data.signedUrl, expiresIn: 600 });
}
