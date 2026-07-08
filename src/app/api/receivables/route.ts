import { NextResponse } from "next/server";
import { receivablesSeed } from "@/lib/mock-data";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapReceivable } from "@/server/entities";

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Carteira", "view");
  const confirmationAuth = auth.ok ? auth : await requirePermission(db, "Confirmação", "view");
  if (!confirmationAuth.ok) return NextResponse.json({ error: confirmationAuth.error }, { status: confirmationAuth.status });
  if (!db) return NextResponse.json(receivablesSeed);

  const receivables = await db.receivable.findMany({
    where: { deletedAt: null },
    include: { assignor: true, debtor: true, batch: true, portfolio: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(receivables.map(mapReceivable));
}
