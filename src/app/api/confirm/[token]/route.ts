import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { writeAudit } from "@/server/audit";
import { getDbOrNull } from "@/server/db";
import { mapReceivable } from "@/server/entities";

type Context = { params: Promise<{ token: string }> };

const responseMap: Record<string, string> = {
  confirmed: "Confirmado",
  divergent: "Divergente",
  rejected: "Não reconhecido",
};

function requestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? null;
}

async function findToken(db: NonNullable<ReturnType<typeof getDbOrNull>>, token: string) {
  return db.confirmationToken.findUnique({
    where: { token },
    include: {
      receivable: {
        include: { assignor: true, debtor: true, batch: true, portfolio: true },
      },
    },
  });
}

export async function GET(_request: Request, context: Context) {
  const db = getDbOrNull();
  if (!db) return NextResponse.json({ error: "Banco de dados indisponível." }, { status: 503 });

  const { token } = await context.params;
  const record = await findToken(db, token);
  if (!record || record.revokedAt || record.receivable.deletedAt) return NextResponse.json({ error: "Link inválido." }, { status: 404 });

  const expired = record.expiresAt < new Date();
  return NextResponse.json({
    token: record.token,
    expiresAt: record.expiresAt.toISOString(),
    usedAt: record.usedAt?.toISOString() ?? null,
    expired,
    receivable: {
      id: record.receivable.externalId,
      assignor: record.receivable.assignor.legalName,
      debtor: record.receivable.debtor.legalName,
      issueDate: record.receivable.issueDate.toISOString(),
      dueDate: record.receivable.dueDate.toISOString(),
      faceValue: record.receivable.faceValue.toString(),
      confirmationStatus: record.receivable.confirmationStatus,
    },
  });
}

export async function POST(request: Request, context: Context) {
  const db = getDbOrNull();
  if (!db) return NextResponse.json({ error: "Banco de dados indisponível." }, { status: 503 });

  const { token } = await context.params;
  const record = await findToken(db, token);
  if (!record || record.revokedAt || record.receivable.deletedAt) return NextResponse.json({ error: "Link inválido." }, { status: 404 });
  if (record.usedAt) return NextResponse.json({ error: "Este link já foi utilizado." }, { status: 409 });
  if (record.expiresAt < new Date()) return NextResponse.json({ error: "Este link expirou." }, { status: 410 });

  const body = await request.json().catch(() => null);
  const response = String(body?.response ?? "").trim();
  const confirmationStatus = responseMap[response];
  if (!confirmationStatus) return NextResponse.json({ error: "Resposta inválida." }, { status: 400 });

  const respondentName = String(body?.respondentName ?? "").trim();
  const respondentRole = String(body?.respondentRole ?? "").trim();
  const respondentEmail = String(body?.respondentEmail ?? "").trim().toLowerCase();
  const respondentPhone = String(body?.respondentPhone ?? "").trim();
  const responseNotes = String(body?.responseNotes ?? "").trim();

  if (respondentName.length < 3) return NextResponse.json({ error: "Informe o nome do responsável." }, { status: 400 });
  if (respondentRole.length < 2) return NextResponse.json({ error: "Informe cargo ou área." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(respondentEmail)) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  if (response !== "confirmed" && responseNotes.length < 5) {
    return NextResponse.json({ error: "Informe observações para divergência ou não reconhecimento." }, { status: 400 });
  }

  const ipAddress = requestIp(request);
  const userAgent = request.headers.get("user-agent");
  const evidence = {
    tokenId: record.id,
    receivableId: record.receivable.externalId,
    response,
    confirmationStatus,
    respondentName,
    respondentRole,
    respondentEmail,
    respondentPhone,
    responseNotes,
    ipAddress,
    userAgent,
    respondedAt: new Date().toISOString(),
  };
  const evidenceHash = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  const channel = "Link seguro";
  const notes = responseNotes || `Resposta eletrônica recebida de ${respondentName} (${respondentRole})`;

  const result = await db.$transaction(async (tx) => {
    const updatedReceivable = await tx.receivable.update({
      where: { id: record.receivableId },
      data: {
        confirmationStatus,
        confirmationChannel: channel,
        confirmationEvidence: evidenceHash,
        confirmationNotes: notes,
        confirmedAt: new Date(),
        confirmedById: null,
      },
      include: { assignor: true, debtor: true, batch: true, portfolio: true },
    });

    const updatedToken = await tx.confirmationToken.update({
      where: { id: record.id },
      data: {
        usedAt: new Date(),
        responseStatus: confirmationStatus,
        respondentName,
        respondentRole,
        respondentEmail,
        respondentPhone: respondentPhone || null,
        responseNotes: responseNotes || null,
        evidenceHash,
        ipAddress,
        userAgent,
      },
    });

    await tx.workflowTransition.create({
      data: {
        receivableId: record.receivableId,
        fromStatus: record.receivable.status,
        toStatus: record.receivable.status,
        reason: `Confirmação externa ${confirmationStatus} · ${channel}`,
        createdById: record.createdById ?? undefined,
      },
    });

    return { updatedReceivable, updatedToken };
  });

  await writeAudit(db, {
    action: "RECEIVABLE_EXTERNAL_CONFIRMATION_RECEIVED",
    entityType: "Receivable",
    entityId: result.updatedReceivable.externalId,
    userId: record.createdById,
    before: {
      confirmationStatus: record.receivable.confirmationStatus,
      confirmationChannel: record.receivable.confirmationChannel,
      confirmationEvidence: record.receivable.confirmationEvidence,
      confirmationNotes: record.receivable.confirmationNotes,
    },
    after: {
      confirmationStatus: result.updatedReceivable.confirmationStatus,
      confirmationChannel: result.updatedReceivable.confirmationChannel,
      confirmationEvidence: result.updatedReceivable.confirmationEvidence,
      confirmationNotes: result.updatedReceivable.confirmationNotes,
      tokenId: result.updatedToken.id,
      respondentName,
      respondentRole,
      respondentEmail,
      evidenceHash,
    },
  });

  return NextResponse.json({ ok: true, receivable: mapReceivable(result.updatedReceivable), evidenceHash });
}
