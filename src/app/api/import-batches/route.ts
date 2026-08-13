import { NextResponse } from "next/server";
import { buildDemoCsv, parseBrDate, parseCsvReceivables } from "@/lib/domain";
import { parseXmlNfeReceivables, parseXmlNfeReceivablesForUi } from "@/lib/xml-import";
import { batchesSeed } from "@/lib/mock-data";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapBatch, mapDebtor, mapDocument, mapReceivable } from "@/server/entities";
import { writeAudit } from "@/server/audit";
import { DOCUMENT_BUCKET, ensureDocumentBucket, getStorageClient } from "@/server/storage";
import type { PrismaClient } from "@prisma/client";

function nextBatchCode(count: number) {
  return `LOT-${String(count + 1).padStart(3, "0")}`;
}

function nextDebtorCode(count: number) {
  return `SAC-${String(count + 200).padStart(3, "0")}`;
}

function nextDocumentCode(count: number) {
  return `DOC-${String(count + 1).padStart(3, "0")}`;
}

function isXmlImport(fileName: string, content: string) {
  return fileName.toLowerCase().endsWith(".xml") || /^\s*<\?xml|^\s*<(?:[\w.-]+:)?nfeProc\b|^\s*<(?:[\w.-]+:)?NFe\b/i.test(content);
}

function isFile(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File && value.size > 0;
}

async function parseImportRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const files = form.getAll("files").filter(isFile);
    const xmlFile = files.find((file) => file.name.toLowerCase().endsWith(".xml"));
    const csvFile = files.find((file) => file.name.toLowerCase().endsWith(".csv"));
    const sourceFile = xmlFile ?? csvFile;
    const pdfFiles = files.filter((file) => file.name.toLowerCase().endsWith(".pdf"));
    if (!sourceFile) {
      return {
        fileName: pdfFiles[0]?.name ?? "arquivo_sem_xml",
        content: "",
        pdfFiles,
        requestErrors: ["Envie um XML NF-e ou CSV junto com o PDF."],
      };
    }
    return {
      fileName: sourceFile.name,
      content: await sourceFile.text(),
      pdfFiles,
      requestErrors: [] as string[],
    };
  }

  const body = await request.json().catch(() => null);
  return {
    fileName: String(body?.fileName || "modelo_demo.csv"),
    content: String(body?.content || buildDemoCsv()),
    pdfFiles: [] as File[],
    requestErrors: [] as string[],
  };
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

async function attachPdfDocuments({
  db,
  files,
  receivables,
  userId,
}: {
  db: PrismaClient;
  files: File[];
  receivables: { id: string; externalId: string }[];
  userId: string;
}) {
  if (!files.length) return { documents: [], errors: [] as string[] };
  if (!receivables.length) return { documents: [], errors: ["PDF/DANFE não anexado: nenhuma duplicata foi criada no lote."] };

  const storage = getStorageClient();
  if (!storage) {
    return {
      documents: [],
      errors: ["PDF/DANFE não anexado: storage documental não configurado."],
    };
  }

  await ensureDocumentBucket(storage);
  const documents = [];
  const errors: string[] = [];
  let documentCount = await db.document.count();

  for (const receivable of receivables) {
    for (const file of files) {
      const code = nextDocumentCode(documentCount++);
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const storageKey = `${code}/${Date.now()}-${safeName}`;
      const bytes = Buffer.from(await file.arrayBuffer());
      const { error } = await storage.storage.from(DOCUMENT_BUCKET).upload(storageKey, bytes, {
        contentType: file.type || "application/pdf",
        upsert: false,
      });

      if (error) {
        errors.push(`PDF ${file.name}: ${error.message}`);
        continue;
      }

      const document = await db.document.create({
        data: {
          code,
          name: `DANFE / emissão NF-e · ${file.name}`,
          type: "COLLATERAL",
          status: "VALID",
          stage: "Importação",
          requirement: "COMPROVANTE_LASTRO",
          storageKey,
          sizeBytes: file.size,
          receivableId: receivable.id,
          uploadedById: userId,
        },
        include: { receivable: true, purchase: true },
      });
      documents.push(document);

      await writeAudit(db, {
        action: "NFE_PDF_IMPORTED",
        entityType: "Document",
        entityId: document.code,
        userId,
        after: { document, receivable: receivable.externalId, bucket: DOCUMENT_BUCKET, storageKey },
      });
    }
  }

  return { documents, errors };
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Importação", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { fileName, content, pdfFiles, requestErrors } = await parseImportRequest(request);
  const batchCode = nextBatchCode(db ? await db.importBatch.count() : batchesSeed.length);
  const xml = isXmlImport(fileName, content);
  const parsed = xml
    ? parseXmlNfeReceivables(content, batchCode)
    : { ...parseCsvReceivables(content, batchCode), debtors: [] };
  parsed.errors.push(...requestErrors);
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
        errors: parsed.errors,
        createdAt: new Date().toISOString(),
      },
      receivables: parsed.receivables,
      debtors: uiXml?.debtors ?? [],
      documents: [],
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

  const documentResult = await attachPdfDocuments({
    db,
    files: pdfFiles,
    receivables: result.createdReceivables,
    userId: auth.user.id,
  });

  let responseBatch = result.batch;
  if (documentResult.errors.length) {
    parsed.errors.push(...documentResult.errors);
    responseBatch = await db.importBatch.update({
      where: { id: result.batch.id },
      data: {
        status: "Com erros",
        invalidRows: parsed.errors.length,
        validationErrors: parsed.errors,
      },
    });
  }

  return NextResponse.json(
    {
      batch: mapBatch(responseBatch),
      receivables: result.createdReceivables.map(mapReceivable),
      debtors: result.upsertedDebtors.map(mapDebtor),
      documents: documentResult.documents.map((document) => mapDocument(document)),
      errors: parsed.errors,
    },
    { status: 201 },
  );
}
