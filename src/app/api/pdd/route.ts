import { NextResponse } from "next/server";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { calculatePdd, getActivePddPolicy, getPddOverview, savePddPolicy } from "@/server/pdd";

export async function GET(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Risco", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco de dados indisponível." }, { status: 503 });
  const referenceDate = new URL(request.url).searchParams.get("referenceDate") ?? undefined;
  return NextResponse.json(await getPddOverview(db, referenceDate, auth.user.id));
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Risco", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco de dados indisponível." }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const overview = await calculatePdd(db, body.referenceDate, auth.user.id);
  await writeAudit(db, {
    action: "PDD_CALCULATED",
    entityType: "PddCalculation",
    entityId: overview.referenceDate,
    userId: auth.user.id,
    after: overview.summary,
  });
  return NextResponse.json(overview);
}

export async function PUT(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Risco", "approve");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco de dados indisponível." }, { status: 503 });
  const before = await getActivePddPolicy(db, auth.user.id);
  const policy = await savePddPolicy(db, await request.json(), auth.user.id);
  await writeAudit(db, {
    action: "PDD_POLICY_UPDATED",
    entityType: "PddPolicy",
    entityId: policy.id,
    userId: auth.user.id,
    before,
    after: policy,
  });
  return NextResponse.json(await getPddOverview(db, undefined, auth.user.id));
}

export async function PATCH(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Risco", "approve");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco de dados indisponível." }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const referenceDate = String(body.referenceDate ?? "");
  const date = new Date(`${referenceDate.slice(0, 10)}T00:00:00.000Z`);
  if (!referenceDate || Number.isNaN(date.getTime())) return NextResponse.json({ error: "Data de referência inválida." }, { status: 400 });
  const result = await db.pddCalculation.updateMany({
    where: { referenceDate: date },
    data: { status: "Aprovado", approvedById: auth.user.id, approvedAt: new Date() },
  });
  await writeAudit(db, {
    action: "PDD_APPROVED",
    entityType: "PddCalculation",
    entityId: referenceDate,
    userId: auth.user.id,
    after: { approvedCount: result.count },
  });
  return NextResponse.json(await getPddOverview(db, referenceDate, auth.user.id));
}

