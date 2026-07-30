import { NextResponse } from "next/server";
import { auditsSeed } from "@/lib/mock-data";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapAudit } from "@/server/entities";

export async function GET() {
  const db = getDbOrNull();
  if (!db) return NextResponse.json(auditsSeed);
  const auth = await requirePermission(db, "Relatórios", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const audits = await db.auditLog.findMany({
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(audits.map(mapAudit));
}
