import { NextResponse } from "next/server";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { getPurchaseDocumentGaps, requiredDocumentsForPurchase } from "@/server/document-policy";

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Documentos", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json([]);

  const receivables = await db.receivable.findMany({
    where: { deletedAt: null, status: { in: ["ELIGIBLE", "APPROVED", "REVIEW", "INELIGIBLE"] } },
    include: { assignor: true, debtor: true },
    orderBy: { dueDate: "asc" },
  });

  const rows = await Promise.all(
    receivables.map(async (receivable) => {
      const required = requiredDocumentsForPurchase(receivable);
      const gaps = await getPurchaseDocumentGaps(db, receivable);
      return {
        receivableId: receivable.externalId,
        assignor: receivable.assignor.legalName,
        debtor: receivable.debtor.legalName,
        status: receivable.status,
        required,
        gaps,
        ok: gaps.length === 0,
      };
    }),
  );

  return NextResponse.json(rows);
}
