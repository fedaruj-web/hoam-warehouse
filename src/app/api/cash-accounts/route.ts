import { NextResponse } from "next/server";
import { requirePermission } from "@/server/authz";
import { writeAudit } from "@/server/audit";
import { ensureDefaultCashAccounts } from "@/server/cash";
import { getDbOrNull } from "@/server/db";
import { mapCashAccount } from "@/server/entities";

function nextAccountCode(count: number) {
  return `CTA-WH-${String(count + 1).padStart(3, "0")}`;
}

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Caixa", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json([]);

  await ensureDefaultCashAccounts(db);
  const accounts = await db.cashAccount.findMany({
    where: { deletedAt: null },
    include: { movements: { where: { deletedAt: null } } },
    orderBy: [{ purpose: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(accounts.map(mapCashAccount));
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Caixa", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const openingBalance = Number(body?.openingBalance ?? 0);
  if (!name) return NextResponse.json({ error: "Nome da conta é obrigatório." }, { status: 400 });
  if (!Number.isFinite(openingBalance)) return NextResponse.json({ error: "Saldo inicial inválido." }, { status: 400 });

  const account = await db.cashAccount.create({
    data: {
      code: nextAccountCode(await db.cashAccount.count()),
      name,
      bankName: String(body?.bankName ?? "").trim() || null,
      branch: String(body?.branch ?? "").trim() || null,
      accountNumber: String(body?.accountNumber ?? "").trim() || null,
      accountType: String(body?.accountType ?? "Conta movimento"),
      purpose: String(body?.purpose ?? "OPERATING"),
      currency: String(body?.currency ?? "BRL"),
      openingBalance,
      status: String(body?.status ?? "Ativa"),
    },
    include: { movements: true },
  });

  await writeAudit(db, {
    action: "CASH_ACCOUNT_CREATED",
    entityType: "CashAccount",
    entityId: account.code,
    userId: auth.user.id,
    after: account,
  });

  return NextResponse.json(mapCashAccount(account), { status: 201 });
}
