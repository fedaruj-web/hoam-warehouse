import { NextResponse } from "next/server";
import { receivablesSeed } from "@/lib/mock-data";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapReceivable } from "@/server/entities";

type Context = { params: Promise<{ id: string }> };

const allowedStatuses = ["Pendente", "Confirmado", "Divergente", "Sem resposta", "Dispensado"] as const;

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Confirmação", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const confirmationStatus = String(body?.confirmationStatus ?? "").trim();
  const confirmationChannel = String(body?.confirmationChannel ?? "E-mail").trim() || "E-mail";
  const confirmationEvidence = String(body?.confirmationEvidence ?? "").trim();
  const confirmationNotes = String(body?.confirmationNotes ?? "").trim();

  if (!allowedStatuses.includes(confirmationStatus as (typeof allowedStatuses)[number])) {
    return NextResponse.json({ error: "Status de confirmação inválido." }, { status: 400 });
  }

  if (!db) {
    const receivable = receivablesSeed.find((item) => item.id === id);
    if (!receivable) return NextResponse.json({ error: "Duplicata não encontrada." }, { status: 404 });
    return NextResponse.json({
      ...receivable,
      confirmationStatus,
      confirmationChannel,
      confirmationEvidence,
      confirmationNotes,
      confirmedAt: confirmationStatus === "Pendente" ? null : new Date().toISOString(),
    });
  }

  const before = await db.receivable.findUnique({
    where: { externalId: id },
    include: { assignor: true, debtor: true, batch: true },
  });
  if (!before || before.deletedAt) return NextResponse.json({ error: "Duplicata não encontrada." }, { status: 404 });
  if (before.status === "PURCHASED" || before.status === "SETTLED") {
    return NextResponse.json({ error: "Duplicata em carteira ou liquidada não pode ter confirmação alterada." }, { status: 400 });
  }

  const confirmedAt = confirmationStatus === "Pendente" ? null : new Date();
  const updated = await db.receivable.update({
    where: { id: before.id },
    data: {
      confirmationStatus,
      confirmationChannel,
      confirmationEvidence: confirmationEvidence || null,
      confirmationNotes: confirmationNotes || null,
      confirmedAt,
      confirmedById: confirmedAt ? auth.user.id : null,
    },
    include: { assignor: true, debtor: true, batch: true },
  });

  await db.workflowTransition.create({
    data: {
      receivableId: before.id,
      fromStatus: before.status,
      toStatus: before.status,
      reason: `Confirmação ${confirmationStatus} · ${confirmationChannel}`,
      createdById: auth.user.id,
    },
  });

  await writeAudit(db, {
    action: "RECEIVABLE_CONFIRMATION_UPDATED",
    entityType: "Receivable",
    entityId: updated.externalId,
    userId: auth.user.id,
    before: {
      confirmationStatus: before.confirmationStatus,
      confirmationChannel: before.confirmationChannel,
      confirmationEvidence: before.confirmationEvidence,
      confirmationNotes: before.confirmationNotes,
      confirmedAt: before.confirmedAt,
    },
    after: {
      confirmationStatus: updated.confirmationStatus,
      confirmationChannel: updated.confirmationChannel,
      confirmationEvidence: updated.confirmationEvidence,
      confirmationNotes: updated.confirmationNotes,
      confirmedAt: updated.confirmedAt,
    },
  });

  return NextResponse.json(mapReceivable(updated));
}
