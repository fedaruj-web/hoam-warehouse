import { NextResponse } from "next/server";
import type { ReceivableStatus as PrismaReceivableStatus } from "@prisma/client";
import { requirePermission } from "@/server/authz";
import { writeAudit } from "@/server/audit";
import { getOperationalCashAccount } from "@/server/cash";
import { getDbOrNull } from "@/server/db";
import { mapReceivable } from "@/server/entities";

function nextCode(prefix: string, count: number) {
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

function decimalToNumber(value: { toNumber?: () => number } | number | null | undefined) {
  if (value == null) return 0;
  return typeof value === "number" ? value : value.toNumber?.() ?? Number(value);
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Cobrança", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const receivableId = String(body?.receivableId ?? "").trim();
  const action = String(body?.action ?? "settle");
  const amount = Number(body?.amount ?? 0);
  const method = String(body?.method ?? "").trim() || null;
  const notes = String(body?.notes ?? "").trim() || null;
  const date = body?.date ? new Date(String(body.date)) : new Date();

  if (!receivableId) return NextResponse.json({ error: "Ativo não informado." }, { status: 400 });
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: "Data inválida." }, { status: 400 });
  if (!["settle", "mark_overdue", "renegotiate"].includes(action)) {
    return NextResponse.json({ error: "Ação de cobrança inválida." }, { status: 400 });
  }

  const receivable = await db.receivable.findUnique({
    where: { externalId: receivableId },
    include: { assignor: true, debtor: true, batch: true, portfolio: true },
  });

  if (!receivable || receivable.deletedAt) {
    return NextResponse.json({ error: "Ativo não encontrado." }, { status: 404 });
  }
  if (!receivable.portfolio || receivable.portfolio.deletedAt) {
    return NextResponse.json({ error: "Ativo não está registrado na carteira warehouse." }, { status: 409 });
  }
  if (!["PURCHASED", "OVERDUE"].includes(receivable.status)) {
    return NextResponse.json({ error: "Somente ativos comprados ou vencidos podem passar por cobrança/liquidação." }, { status: 409 });
  }

  const outstandingBefore = decimalToNumber(receivable.portfolio.outstandingValue);
  if (outstandingBefore <= 0) {
    return NextResponse.json({ error: "Ativo não possui saldo em aberto." }, { status: 409 });
  }

  if (action === "settle") {
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Valor recebido deve ser maior que zero." }, { status: 400 });
    }
    if (amount - outstandingBefore > 0.01) {
      return NextResponse.json({ error: "Valor recebido não pode exceder o saldo em aberto." }, { status: 409 });
    }
  }

  const settlementCode = nextCode("LIQ", await db.settlement.count());
  const cashCode = nextCode("CX", await db.cashMovement.count());

  const result = await db.$transaction(async (tx) => {
    const settlementAmount = action === "settle" ? amount : 0;
    const outstandingAfter = action === "settle" ? Math.max(0, outstandingBefore - settlementAmount) : outstandingBefore;
    const fullySettled = action === "settle" && outstandingAfter <= 0.01;
    const toStatus: PrismaReceivableStatus =
      action === "mark_overdue" ? "OVERDUE" : fullySettled ? "SETTLED" : "PURCHASED";
    const portfolioStatus =
      action === "mark_overdue"
        ? "Em cobrança"
        : action === "renegotiate"
          ? "Renegociado"
          : fullySettled
            ? "Liquidado"
            : "Liquidação parcial";

    const cashAccount = action === "settle"
      ? await getOperationalCashAccount(tx, "RECEIVABLE_COLLECTION", body?.cashAccountId ? String(body.cashAccountId) : null)
      : null;

    const cashMovement = action === "settle"
      ? await tx.cashMovement.create({
          data: {
            code: cashCode,
            accountId: cashAccount?.id ?? null,
            date,
            description: `Recebimento ${receivable.externalId} · ${method ?? "sem método"}`,
            type: "INFLOW",
            amount: settlementAmount,
            reference: receivable.externalId,
          },
        })
      : null;

    await tx.portfolioItem.update({
      where: { receivableId: receivable.id },
      data: {
        outstandingValue: outstandingAfter,
        status: portfolioStatus,
      },
    });

    await tx.receivable.update({
      where: { id: receivable.id },
      data: { status: toStatus },
    });

    const settlement = await tx.settlement.create({
      data: {
        code: settlementCode,
        receivableId: receivable.id,
        createdById: auth.user.id,
        cashMovementId: cashMovement?.id ?? null,
        action: action === "settle" ? (fullySettled ? "TOTAL" : "PARTIAL") : action === "mark_overdue" ? "OVERDUE" : "RENEGOTIATED",
        amount: action === "settle" ? settlementAmount : null,
        date,
        method,
        notes,
        outstandingBefore,
        outstandingAfter,
      },
    });

    await tx.workflowTransition.create({
      data: {
        receivableId: receivable.id,
        fromStatus: receivable.status as PrismaReceivableStatus,
        toStatus,
        reason: `${settlement.code} · ${portfolioStatus}${notes ? ` · ${notes}` : ""}`,
        createdById: auth.user.id,
      },
    });

    const updated = await tx.receivable.findUniqueOrThrow({
      where: { id: receivable.id },
      include: { assignor: true, debtor: true, batch: true, portfolio: true },
    });

    return { updated, settlement, cashMovement };
  });

  await writeAudit(db, {
    action: result.settlement.action === "TOTAL" ? "RECEIVABLE_SETTLED" : "COLLECTION_EVENT_RECORDED",
    entityType: "Receivable",
    entityId: receivable.externalId,
    userId: auth.user.id,
    before: receivable,
    after: result,
  });

  return NextResponse.json({
    receivable: mapReceivable(result.updated),
    settlement: result.settlement,
    cashMovement: result.cashMovement,
  }, { status: 201 });
}
