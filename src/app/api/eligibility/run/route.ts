import { NextResponse } from "next/server";
import type { ReceivableStatus as PrismaReceivableStatus } from "@prisma/client";
import { evaluateReceivable } from "@/lib/domain";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapAssignor, mapDebtor, mapReceivable, receivableStatusToPrisma } from "@/server/entities";
import { writeAudit } from "@/server/audit";

const activePolicy = {
  code: "POL-WH-ELIG",
  name: "Política de Elegibilidade Warehouse",
  version: 15,
  label: "Política v1.5 · confirmação, limite e concentração",
  effectiveAt: "2026-07-08",
};

async function getOrCreateRule(
  db: NonNullable<ReturnType<typeof getDbOrNull>>,
  name: string,
) {
  const existing = await db.eligibilityRule.findFirst({
    where: { name, version: activePolicy.version, deletedAt: null },
  });
  if (existing) return existing;

  return db.eligibilityRule.create({
    data: {
      name,
      ruleType: "BASIC",
      operator: "AUTO",
      value: { source: "WAREHOUSE_ELIGIBILITY_ENGINE", policy: activePolicy },
      policyCode: activePolicy.code,
      policyName: activePolicy.name,
      effectiveAt: new Date(`${activePolicy.effectiveAt}T00:00:00.000Z`),
      version: activePolicy.version,
    },
  });
}

export async function POST() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Elegibilidade", "approve");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ updated: 0 });

  const receivables = await db.receivable.findMany({
    where: { deletedAt: null, status: { notIn: ["PURCHASED", "SETTLED"] } },
    include: { assignor: true, debtor: true, batch: true },
    orderBy: { createdAt: "desc" },
  });

  const assignors = receivables.map((item) => mapAssignor(item.assignor));
  const debtors = receivables.map((item) => mapDebtor(item.debtor));
  const updated = [];

  for (const item of receivables) {
    const uiReceivable = mapReceivable(item);
    const result = evaluateReceivable(uiReceivable, assignors, debtors);
    const status = (receivableStatusToPrisma[result.status] ?? "REVIEW") as PrismaReceivableStatus;

    const persisted = await db.receivable.update({
      where: { id: item.id },
      data: { status },
      include: { assignor: true, debtor: true, batch: true },
    });

    await db.workflowTransition.create({
      data: {
        receivableId: item.id,
        fromStatus: item.status,
        toStatus: status,
        reason: `Motor básico · score ${result.score}`,
        createdById: auth.user.id,
      },
    });

    for (const check of result.checks) {
      const rule = await getOrCreateRule(db, check.rule);
      await db.eligibilityEvaluation.upsert({
        where: {
          receivableId_ruleId: {
            receivableId: item.id,
            ruleId: rule.id,
          },
        },
        create: {
          receivableId: item.id,
          ruleId: rule.id,
          passed: check.passed,
          message: check.message,
          policyVersion: activePolicy.version,
          policySnapshot: activePolicy,
        },
        update: {
          passed: check.passed,
          message: check.message,
          policyVersion: activePolicy.version,
          policySnapshot: activePolicy,
          evaluatedAt: new Date(),
        },
      });
    }

    updated.push(mapReceivable(persisted));
  }

  await writeAudit(db, {
    action: "ELIGIBILITY_ENGINE_RUN",
    entityType: "Receivable",
    entityId: "BATCH",
    userId: auth.user.id,
    after: { updated: updated.length, policy: activePolicy },
  });

  return NextResponse.json({ updated: updated.length, receivables: updated, policy: activePolicy });
}
