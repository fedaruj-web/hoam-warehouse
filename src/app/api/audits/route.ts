import { NextResponse } from "next/server";
import { auditsSeed } from "@/lib/mock-data";
import { getDbOrNull } from "@/server/db";
import { mapAudit } from "@/server/entities";

export async function GET() {
  const db = getDbOrNull();
  if (!db) return NextResponse.json(auditsSeed);

  const audits = await db.auditLog.findMany({
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(audits.map(mapAudit));
}

