import { NextResponse } from "next/server";
import { getDbOrNull } from "@/server/db";
import { requirePermission } from "@/server/authz";
import { getActiveEligibilityPolicy, saveActiveEligibilityPolicy } from "@/server/eligibility-policy";
import { writeAudit } from "@/server/audit";

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Elegibilidade", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const policy = await getActiveEligibilityPolicy(db);
  return NextResponse.json(policy);
}

export async function PUT(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Elegibilidade", "approve");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json(await request.json().catch(() => null));

  const before = await getActiveEligibilityPolicy(db);
  const body = await request.json().catch(() => null);
  const policy = await saveActiveEligibilityPolicy(db, body);

  await writeAudit(db, {
    action: "ELIGIBILITY_POLICY_UPDATED",
    entityType: "EligibilityRule",
    entityId: policy.code,
    userId: auth.user.id,
    before,
    after: policy,
  });

  return NextResponse.json(policy);
}
