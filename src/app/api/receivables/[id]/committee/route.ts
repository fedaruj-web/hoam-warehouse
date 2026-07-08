import { NextResponse } from "next/server";
import type { ReceivableStatus as PrismaReceivableStatus } from "@prisma/client";
import { receivablesSeed } from "@/lib/mock-data";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapReceivable } from "@/server/entities";

type Context = { params: Promise<{ id: string }> };

const decisions = {
  approve: { label: "Aprovado por exceção", status: "APPROVED" },
  reject: { label: "Reprovado pelo comitê", status: "INELIGIBLE" },
  request_documents: { label: "Solicitação de documentos", status: "REVIEW" },
  return_confirmation: { label: "Devolvido para confirmação", status: "REVIEW" },
} as const;

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Comitê", "approve");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const decision = String(body?.decision ?? "").trim() as keyof typeof decisions;
  const justification = String(body?.justification ?? "").trim();
  const selected = decisions[decision];

  if (!selected) return NextResponse.json({ error: "Decisão inválida." }, { status: 400 });
  if (justification.length < 10) {
    return NextResponse.json({ error: "Justificativa obrigatória com ao menos 10 caracteres." }, { status: 400 });
  }

  if (!db) {
    const receivable = receivablesSeed.find((item) => item.id === id);
    if (!receivable) return NextResponse.json({ error: "Ativo não encontrado." }, { status: 404 });
    return NextResponse.json({ ...receivable, status: mapStatusToUi(selected.status) });
  }

  const before = await db.receivable.findUnique({
    where: { externalId: id },
    include: { assignor: true, debtor: true, batch: true, portfolio: true },
  });
  if (!before || before.deletedAt) return NextResponse.json({ error: "Ativo não encontrado." }, { status: 404 });
  if (before.status === "PURCHASED" || before.status === "SETTLED") {
    return NextResponse.json({ error: "Ativo comprado ou liquidado não pode ser decidido pelo comitê." }, { status: 400 });
  }

  const status = selected.status as PrismaReceivableStatus;
  const updated = await db.receivable.update({
    where: { id: before.id },
    data: { status },
    include: { assignor: true, debtor: true, batch: true },
  });

  await db.workflowTransition.create({
    data: {
      receivableId: before.id,
      fromStatus: before.status,
      toStatus: status,
      reason: `${selected.label} · ${justification}`,
      createdById: auth.user.id,
    },
  });

  await writeAudit(db, {
    action: "COMMITTEE_DECISION",
    entityType: "Receivable",
    entityId: updated.externalId,
    userId: auth.user.id,
    before: { status: before.status },
    after: { decision, status, justification },
  });

  return NextResponse.json(mapReceivable(updated));
}

function mapStatusToUi(status: string) {
  if (status === "APPROVED") return "Aprovado";
  if (status === "INELIGIBLE") return "Inelegível";
  return "Revisão";
}
