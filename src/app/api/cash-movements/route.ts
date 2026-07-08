import { NextResponse } from "next/server";
import { requirePermission } from "@/server/authz";
import { writeAudit } from "@/server/audit";
import { getOperationalCashAccount } from "@/server/cash";
import { getDbOrNull } from "@/server/db";
import { mapCashMovement } from "@/server/entities";

function nextCashCode(count: number) {
  return `CX-${String(count + 1).padStart(4, "0")}`;
}

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Caixa", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json([]);

  const movements = await db.cashMovement.findMany({
    where: { deletedAt: null },
    include: { account: true },
    orderBy: { date: "desc" },
    take: 200,
  });

  return NextResponse.json(movements.map(mapCashMovement));
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Caixa", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const amount = Number(body?.amount ?? 0);
  const type = String(body?.type ?? "INFLOW") === "OUTFLOW" ? "OUTFLOW" : "INFLOW";
  const date = body?.date ? new Date(String(body.date)) : new Date();
  const description = String(body?.description ?? "").trim();
  if (!description) return NextResponse.json({ error: "Descrição é obrigatória." }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Valor deve ser maior que zero." }, { status: 400 });
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: "Data inválida." }, { status: 400 });

  const account = await getOperationalCashAccount(db, "RESERVE", String(body?.accountId ?? "") || null);
  const movement = await db.cashMovement.create({
    data: {
      code: nextCashCode(await db.cashMovement.count()),
      accountId: account.id,
      date,
      description,
      type,
      amount,
      reference: String(body?.reference ?? "").trim() || null,
    },
    include: { account: true },
  });

  await writeAudit(db, {
    action: "CASH_MOVEMENT_CREATED",
    entityType: "CashMovement",
    entityId: movement.code,
    userId: auth.user.id,
    after: movement,
  });

  return NextResponse.json(mapCashMovement(movement), { status: 201 });
}
