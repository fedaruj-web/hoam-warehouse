import { NextResponse } from "next/server";
import { buildDemoCsv, parseBrDate, parseCsvReceivables } from "@/lib/domain";
import { batchesSeed } from "@/lib/mock-data";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapBatch, mapReceivable } from "@/server/entities";
import { writeAudit } from "@/server/audit";

function nextBatchCode(count: number) {
  return `LOT-${String(count + 1).padStart(3, "0")}`;
}

export async function GET() {
  const db = getDbOrNull();
  if (!db) return NextResponse.json(batchesSeed);

  const batches = await db.importBatch.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(batches.map(mapBatch));
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Importação", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const fileName = String(body?.fileName || "modelo_demo.csv");
  const content = String(body?.content || buildDemoCsv());
  const batchCode = nextBatchCode(db ? await db.importBatch.count() : batchesSeed.length);
  const parsed = parseCsvReceivables(content, batchCode);

  if (!db) {
    return NextResponse.json({
      batch: {
        id: batchCode,
        fileName,
        status: parsed.errors.length ? "Com erros" : "Validado",
        totalRows: parsed.receivables.length + parsed.errors.length,
        validRows: parsed.receivables.length,
        invalidRows: parsed.errors.length,
        createdAt: new Date().toISOString(),
      },
      receivables: parsed.receivables,
      errors: parsed.errors,
    });
  }

  const result = await db.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({
      data: {
        code: batchCode,
        fileName,
        status: parsed.errors.length ? "Com erros" : "Validado",
        totalRows: parsed.receivables.length + parsed.errors.length,
        validRows: parsed.receivables.length,
        invalidRows: parsed.errors.length,
        validationErrors: parsed.errors.length ? parsed.errors : undefined,
        importedById: auth.user.id,
      },
    });

    const created = [];
    for (const item of parsed.receivables) {
      const [assignor, debtor] = await Promise.all([
        tx.assignor.findFirst({ where: { legalName: item.ced, deletedAt: null } }),
        tx.debtor.findFirst({ where: { legalName: item.sac, deletedAt: null } }),
      ]);

      if (!assignor || !debtor) {
        continue;
      }

      const existing = await tx.receivable.findUnique({ where: { externalId: item.id } });
      if (existing) {
        continue;
      }

      const receivable = await tx.receivable.create({
        data: {
          externalId: item.id,
          assignorId: assignor.id,
          debtorId: debtor.id,
          batchId: batch.id,
          issueDate: parseBrDate(item.emissao),
          dueDate: parseBrDate(item.venc),
          faceValue: item.valor,
          status: "IMPORTED",
        },
        include: { assignor: true, debtor: true, batch: true },
      });
      created.push(receivable);
    }

    await writeAudit(tx, {
      action: "RECEIVABLE_BATCH_IMPORTED",
      entityType: "ImportBatch",
      entityId: batch.code,
      userId: auth.user.id,
      after: { batch, imported: created.length, errors: parsed.errors },
    });

    return { batch, created };
  });

  return NextResponse.json(
    {
      batch: mapBatch(result.batch),
      receivables: result.created.map(mapReceivable),
      errors: parsed.errors,
    },
    { status: 201 },
  );
}
