import { NextResponse } from "next/server";
import { requirePermission } from "@/server/authz";
import { writeAudit } from "@/server/audit";
import { getOperationalCashAccount } from "@/server/cash";
import { getDbOrNull } from "@/server/db";
import { mapBankStatementEntry } from "@/server/entities";

function nextStatementCode(count: number) {
  return `EXT-${String(count + 1).padStart(4, "0")}`;
}

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Caixa", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json([]);

  const entries = await db.bankStatementEntry.findMany({
    where: { deletedAt: null },
    include: { account: true, cashMovement: true },
    orderBy: { statementDate: "desc" },
    take: 200,
  });
  return NextResponse.json(entries.map(mapBankStatementEntry));
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Caixa", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const amount = Number(body?.amount ?? 0);
  const statementDate = body?.date ? new Date(String(body.date)) : new Date();
  const description = String(body?.description ?? "").trim();
  const type = String(body?.type ?? "INFLOW") === "OUTFLOW" ? "OUTFLOW" : "INFLOW";
  if (!description) return NextResponse.json({ error: "Descrição é obrigatória." }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Valor deve ser maior que zero." }, { status: 400 });
  if (Number.isNaN(statementDate.getTime())) return NextResponse.json({ error: "Data inválida." }, { status: 400 });

  const account = await getOperationalCashAccount(db, "RESERVE", String(body?.accountId ?? "") || null);
  const entry = await db.bankStatementEntry.create({
    data: {
      code: nextStatementCode(await db.bankStatementEntry.count()),
      accountId: account.id,
      statementDate,
      description,
      type,
      amount,
      reference: String(body?.reference ?? "").trim() || null,
      status: "Pendente",
      notes: String(body?.notes ?? "").trim() || null,
    },
    include: { account: true, cashMovement: true },
  });

  await writeAudit(db, {
    action: "BANK_STATEMENT_ENTRY_CREATED",
    entityType: "BankStatementEntry",
    entityId: entry.code,
    userId: auth.user.id,
    after: entry,
  });

  return NextResponse.json(mapBankStatementEntry(entry), { status: 201 });
}

export async function PATCH(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Caixa", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const entryCode = String(body?.entryId ?? "").trim();
  const action = String(body?.action ?? "auto_match");
  if (!entryCode) return NextResponse.json({ error: "Item de extrato não informado." }, { status: 400 });

  const entry = await db.bankStatementEntry.findUnique({
    where: { code: entryCode },
    include: { account: true, cashMovement: true },
  });
  if (!entry || entry.deletedAt) return NextResponse.json({ error: "Item de extrato não encontrado." }, { status: 404 });

  if (action === "mark_divergent") {
    const updated = await db.bankStatementEntry.update({
      where: { id: entry.id },
      data: { status: "Divergente", notes: String(body?.notes ?? "Sem correspondência no caixa."), cashMovementId: null },
      include: { account: true, cashMovement: true },
    });
    await writeAudit(db, { action: "BANK_STATEMENT_DIVERGENT", entityType: "BankStatementEntry", entityId: updated.code, userId: auth.user.id, before: entry, after: updated });
    return NextResponse.json(mapBankStatementEntry(updated));
  }

  const movementCode = String(body?.cashMovementId ?? "").trim();
  const movement = movementCode
    ? await db.cashMovement.findUnique({ where: { code: movementCode }, include: { account: true } })
    : await db.cashMovement.findFirst({
        where: {
          deletedAt: null,
          accountId: entry.accountId,
          type: entry.type,
          amount: entry.amount,
          statementEntries: { none: { status: "Conciliado" } },
        },
        include: { account: true },
        orderBy: { date: "desc" },
      });

  if (!movement || movement.deletedAt || movement.accountId !== entry.accountId || movement.type !== entry.type || !movement.amount.equals(entry.amount)) {
    const updated = await db.bankStatementEntry.update({
      where: { id: entry.id },
      data: { status: "Divergente", notes: "Nenhum movimento de caixa equivalente encontrado." },
      include: { account: true, cashMovement: true },
    });
    await writeAudit(db, { action: "BANK_STATEMENT_MATCH_FAILED", entityType: "BankStatementEntry", entityId: updated.code, userId: auth.user.id, before: entry, after: updated });
    return NextResponse.json(mapBankStatementEntry(updated), { status: 409 });
  }

  const updated = await db.bankStatementEntry.update({
    where: { id: entry.id },
    data: {
      cashMovementId: movement.id,
      status: "Conciliado",
      notes: String(body?.notes ?? "Conciliado automaticamente por conta, tipo e valor."),
      reconciledAt: new Date(),
    },
    include: { account: true, cashMovement: true },
  });

  await writeAudit(db, {
    action: "BANK_STATEMENT_RECONCILED",
    entityType: "BankStatementEntry",
    entityId: updated.code,
    userId: auth.user.id,
    before: entry,
    after: updated,
  });

  return NextResponse.json(mapBankStatementEntry(updated));
}
