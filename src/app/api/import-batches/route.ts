import { NextResponse } from "next/server";
import { buildDemoCsv, parseBrDate, parseCsvReceivables } from "@/lib/domain";
import { parseXmlNfeReceivables, parseXmlNfeReceivablesForUi } from "@/lib/xml-import";
import { batchesSeed } from "@/lib/mock-data";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapBatch, mapDebtor, mapReceivable } from "@/server/entities";
import { writeAudit } from "@/server/audit";

function nextBatchCode(count: number) {
  return `LOT-${String(count + 1).padStart(3, "0")}`;
}

function nextDebtorCode(count: number) {
  return `SAC-${String(count + 200).padStart(3, "0")}`;
}

function isXmlImport(fileName: string, content: string) {
  return fileName.toLowerCase().endsWith(".xml") || /^\s*<\?xml|^\s*<(?:[\w.-]+:)?nfeProc\b|^\s*<(?:[\w.-]+:)?NFe\b/i.test(content);
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
  const xml = isXmlImport(fileName, content);
  const parsed = xml
    ? parseXmlNfeReceivables(content, batchCode)
    : { ...parseCsvReceivables(content, batchCode), debtors: [] };
  const totalRows = parsed.receivables.length + parsed.errors.length;

  if (!db) {
    const uiXml = xml ? parseXmlNfeReceivablesForUi(content, batchCode) : null;
    return NextResponse.json({
      batch: {
        id: batchCode,
        fileName,
        status: parsed.errors.length ? "Com erros" : "Validado",
        totalRows,
        validRows: parsed.receivables.length,
        invalidRows: parsed.errors.length,
        createdAt: new Date().toISOString(),
      },
      receivables: parsed.receivables,
      debtors: uiXml?.debtors ?? [],
      errors: parsed.errors,
    });
  }

  const result = await db.$transaction(async (tx) => {
    let batch = await tx.importBatch.create({
      data: {
        code: batchCode,
        fileName,
        status: parsed.errors.length ? "Com erros" : "Validado",
        totalRows,
        validRows: parsed.receivables.length,
        invalidRows: parsed.errors.length,
        validationErrors: parsed.errors.length ? parsed.errors : undefined,
        importedById: auth.user.id,
      },
    });

    const upsertedDebtors = [];
    let debtorCount = await tx.debtor.count();

    if (xml) {
      for (const debtorDraft of parsed.debtors) {
        const existingDebtor = await tx.debtor.findUnique({ where: { taxId: debtorDraft.taxId } });
        const debtorData = {
          legalName: debtorDraft.legalName,
          tradeName: debtorDraft.tradeName,
          email: debtorDraft.email,
          phone: debtorDraft.phone,
          addressLine: debtorDraft.addressLine,
          addressCity: debtorDraft.addressCity,
          addressState: debtorDraft.addressState,
          financialContactEmail: debtorDraft.confirmationEmail ?? debtorDraft.email,
          financialContactPhone: debtorDraft.confirmationPhone ?? debtorDraft.phone,
          confirmationEmail: debtorDraft.confirmationEmail ?? debtorDraft.email,
          confirmationPhone: debtorDraft.confirmationPhone ?? debtorDraft.phone,
          confirmationChannel: "E-mail",
          confirmationStatus: "Pendente",
          operationalNotes: "Sacado criado/atualizado automaticamente na importação de XML NF-e.",
          status: "ACTIVE" as const,
        };
        const debtor = existingDebtor
          ? await tx.debtor.update({ where: { id: existingDebtor.id }, data: debtorData })
          : await tx.debtor.create({
              data: {
                code: nextDebtorCode(debtorCount++),
                taxId: debtorDraft.taxId,
                rating: "Sem rating",
                exposureLimit: 0,
                ...debtorData,
              },
            });
        upsertedDebtors.push(debtor);
      }
    }

    const createdReceivables = [];
    for (const item of parsed.receivables) {
      const assignorTaxId = "assignorTaxId" in item ? item.assignorTaxId : null;
      const debtorTaxId = "debtorTaxId" in item ? item.debtorTaxId : null;
      const [assignor, debtor] = await Promise.all([
        assignorTaxId
          ? tx.assignor.findFirst({ where: { taxId: assignorTaxId, deletedAt: null } })
          : tx.assignor.findFirst({ where: { legalName: item.ced, deletedAt: null } }),
        debtorTaxId
          ? tx.debtor.findFirst({ where: { taxId: debtorTaxId, deletedAt: null } })
          : tx.debtor.findFirst({ where: { legalName: item.sac, deletedAt: null } }),
      ]);

      if (!assignor || !debtor) {
        if (!assignor && xml) parsed.errors.push(`Duplicata ${item.id}: cedente do XML (${item.ced}) não encontrado. Cadastre o cedente antes da importação.`);
        if (!debtor) parsed.errors.push(`Duplicata ${item.id}: sacado não encontrado ou não pôde ser criado.`);
        continue;
      }

      const existing = await tx.receivable.findUnique({ where: { externalId: item.id } });
      if (existing) {
        parsed.errors.push(`Duplicata ${item.id}: já existe na base.`);
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
          confirmationStatus: item.confirmationStatus ?? "Pendente",
          confirmationChannel: item.confirmationChannel ?? "E-mail",
        },
        include: { assignor: true, debtor: true, batch: true },
      });
      createdReceivables.push(receivable);
    }

    if (parsed.errors.length) {
      batch = await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          status: "Com erros",
          totalRows,
          validRows: createdReceivables.length,
          invalidRows: parsed.errors.length,
          validationErrors: parsed.errors,
        },
      });
    } else if (createdReceivables.length !== parsed.receivables.length) {
      batch = await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          status: "Com erros",
          validRows: createdReceivables.length,
          invalidRows: parsed.receivables.length - createdReceivables.length,
        },
      });
    }

    await writeAudit(tx, {
      action: "RECEIVABLE_BATCH_IMPORTED",
      entityType: "ImportBatch",
      entityId: batch.code,
      userId: auth.user.id,
      after: {
        batch,
        imported: createdReceivables.length,
        debtors: upsertedDebtors.length,
        source: xml ? "XML_NFE" : "CSV",
        errors: parsed.errors,
      },
    });

    return { batch, createdReceivables, upsertedDebtors };
  });

  return NextResponse.json(
    {
      batch: mapBatch(result.batch),
      receivables: result.createdReceivables.map(mapReceivable),
      debtors: result.upsertedDebtors.map(mapDebtor),
      errors: parsed.errors,
    },
    { status: 201 },
  );
}
