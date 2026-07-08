import { NextResponse } from "next/server";
import type { FundingStatus } from "@prisma/client";
import { requirePermission } from "@/server/authz";
import { writeAudit } from "@/server/audit";
import { getDbOrNull } from "@/server/db";
import { fundingStatusToPrisma, mapFundingIssue } from "@/server/entities";

function nextFundingCode(count: number) {
  return `EMI-${String(count + 1).padStart(4, "0")}`;
}

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Funding", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json([]);

  const issues = await db.fundingIssue.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(issues.map(mapFundingIssue));
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Funding", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const instrument = String(body?.instrument ?? "").trim();
  const amount = Number(body?.amount ?? 0);
  const rate = String(body?.rate ?? "").trim();
  const maturity = body?.maturity ? new Date(String(body.maturity)) : null;
  const status = (fundingStatusToPrisma[String(body?.status ?? "Estruturando")] ?? "STRUCTURING") as FundingStatus;

  if (!instrument) return NextResponse.json({ error: "Instrumento é obrigatório." }, { status: 400 });
  if (!rate) return NextResponse.json({ error: "Taxa é obrigatória." }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Valor deve ser maior que zero." }, { status: 400 });
  if (maturity && Number.isNaN(maturity.getTime())) return NextResponse.json({ error: "Vencimento inválido." }, { status: 400 });

  const issue = await db.fundingIssue.create({
    data: {
      code: nextFundingCode(await db.fundingIssue.count()),
      instrument,
      amount,
      rate,
      maturity,
      status,
    },
  });

  await writeAudit(db, {
    action: "FUNDING_ISSUE_CREATED",
    entityType: "FundingIssue",
    entityId: issue.code,
    userId: auth.user.id,
    after: issue,
  });

  return NextResponse.json(mapFundingIssue(issue), { status: 201 });
}

export async function PATCH(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Funding", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? "").trim();
  const status = fundingStatusToPrisma[String(body?.status ?? "")] as FundingStatus | undefined;
  if (!id || !status) return NextResponse.json({ error: "Status inválido." }, { status: 400 });

  const before = await db.fundingIssue.findUnique({ where: { code: id } });
  if (!before || before.deletedAt) return NextResponse.json({ error: "Emissão não encontrada." }, { status: 404 });

  const issue = await db.fundingIssue.update({
    where: { code: id },
    data: { status },
  });

  await writeAudit(db, {
    action: "FUNDING_STATUS_UPDATED",
    entityType: "FundingIssue",
    entityId: issue.code,
    userId: auth.user.id,
    before,
    after: issue,
  });

  return NextResponse.json(mapFundingIssue(issue));
}
