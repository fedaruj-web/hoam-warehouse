import { NextResponse } from "next/server";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapReceivable } from "@/server/entities";

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Carteira", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json([]);

  const items = await db.portfolioItem.findMany({
    where: { deletedAt: null },
    include: {
      receivable: {
        include: { assignor: true, debtor: true, batch: true, portfolio: true },
      },
    },
    orderBy: { acquisitionDate: "desc" },
  });

  return NextResponse.json(items.map((item) => mapReceivable(item.receivable)));
}
