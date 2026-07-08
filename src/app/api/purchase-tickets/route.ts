import { NextResponse } from "next/server";
import { requirePermission } from "@/server/authz";
import { writeAudit } from "@/server/audit";
import { getDbOrNull } from "@/server/db";

type TicketItemInput = {
  externalId?: unknown;
  assignorName?: unknown;
  debtorName?: unknown;
  dueDate?: unknown;
  faceValue?: unknown;
  purchasePrice?: unknown;
  effectiveRate?: unknown;
  riskSpread?: unknown;
  status?: unknown;
  readinessSnapshot?: unknown;
  pricingSnapshot?: unknown;
};

function nextTicketCode(count: number) {
  return `BOL-${String(count + 1).padStart(4, "0")}`;
}

function numberFrom(value: unknown, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function mapTicket(ticket: {
  code: string;
  status: string;
  faceValue: { toNumber?: () => number } | number;
  purchaseValue: { toNumber?: () => number } | number;
  discountPercent?: { toNumber?: () => number } | number | null;
  effectiveRate?: { toNumber?: () => number } | number | null;
  riskSpread?: { toNumber?: () => number } | number | null;
  readyCount: number;
  blockedCount: number;
  ticketText: string;
  approvalNotes?: string | null;
  submittedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedById?: string | null;
  createdAt: Date;
  items?: { externalId: string }[];
}) {
  const toNumber = (value: { toNumber?: () => number } | number | null | undefined) =>
    typeof value === "number" ? value : value?.toNumber?.() ?? 0;

  return {
    id: ticket.code,
    status: ticket.status,
    faceValue: toNumber(ticket.faceValue),
    purchaseValue: toNumber(ticket.purchaseValue),
    discountPercent: toNumber(ticket.discountPercent),
    effectiveRate: toNumber(ticket.effectiveRate),
    riskSpread: toNumber(ticket.riskSpread),
    readyCount: ticket.readyCount,
    blockedCount: ticket.blockedCount,
    ticketText: ticket.ticketText,
    approvalNotes: ticket.approvalNotes ?? null,
    submittedAt: ticket.submittedAt?.toISOString() ?? null,
    reviewedAt: ticket.reviewedAt?.toISOString() ?? null,
    reviewedById: ticket.reviewedById ?? null,
    createdAt: ticket.createdAt.toISOString(),
    items: ticket.items?.map((item) => item.externalId) ?? [],
  };
}

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Compra", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json([]);

  const tickets = await db.purchaseTicket.findMany({
    where: { deletedAt: null },
    include: { items: { select: { externalId: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json(tickets.map(mapTicket));
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Compra", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const items: TicketItemInput[] = Array.isArray(body?.items) ? body.items : [];
  const ticketText = String(body?.ticketText ?? "").trim();
  if (!ticketText) return NextResponse.json({ error: "Texto da boleta é obrigatório." }, { status: 400 });
  if (!items.length) return NextResponse.json({ error: "Boleta precisa ter ao menos um ativo." }, { status: 400 });

  const externalIds = items.map((item) => String(item?.externalId ?? "")).filter(Boolean);
  const receivables = await db.receivable.findMany({
    where: { externalId: { in: externalIds }, deletedAt: null },
    select: { id: true, externalId: true },
  });
  const receivableByExternalId = new Map(receivables.map((item) => [item.externalId, item]));

  const result = await db.purchaseTicket.create({
    data: {
      code: nextTicketCode(await db.purchaseTicket.count()),
      status: "Rascunho",
      faceValue: numberFrom(body?.faceValue),
      purchaseValue: numberFrom(body?.purchaseValue),
      discountPercent: numberFrom(body?.discountPercent),
      effectiveRate: numberFrom(body?.effectiveRate),
      riskSpread: numberFrom(body?.riskSpread),
      baseAnnualRate: numberFrom(body?.baseAnnualRate),
      serviceFeeBps: Math.round(numberFrom(body?.serviceFeeBps)),
      readyCount: Math.round(numberFrom(body?.readyCount, items.length)),
      blockedCount: Math.round(numberFrom(body?.blockedCount)),
      ticketText,
      snapshot: body?.snapshot ?? {},
      createdById: auth.user.id,
      items: {
        create: items.map((item) => {
          const externalId = String(item?.externalId ?? "");
          return {
            receivableId: receivableByExternalId.get(externalId)?.id ?? null,
            externalId,
            assignorName: String(item?.assignorName ?? ""),
            debtorName: String(item?.debtorName ?? ""),
            dueDate: item?.dueDate ? String(item.dueDate) : null,
            faceValue: numberFrom(item?.faceValue),
            purchasePrice: numberFrom(item?.purchasePrice),
            effectiveRate: numberFrom(item?.effectiveRate),
            riskSpread: numberFrom(item?.riskSpread),
            status: String(item?.status ?? "Pronto"),
            readinessSnapshot: item?.readinessSnapshot ?? {},
            pricingSnapshot: item?.pricingSnapshot ?? {},
          };
        }),
      },
    },
    include: { items: { select: { externalId: true } } },
  });

  await writeAudit(db, {
    action: "PURCHASE_TICKET_CREATED",
    entityType: "PurchaseTicket",
    entityId: result.code,
    userId: auth.user.id,
    after: result,
  });

  return NextResponse.json(mapTicket(result), { status: 201 });
}

export async function PATCH(request: Request) {
  const db = getDbOrNull();
  const body = await request.json().catch(() => null);
  const action = String(body?.action ?? "").trim();
  const requiredAction = action === "submit" || action === "cancel" ? "create" : "approve";
  const auth = await requirePermission(db, "Compra", requiredAction);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const code = String(body?.id ?? body?.code ?? "").trim();
  const notes = String(body?.notes ?? "").trim();
  if (!code) return NextResponse.json({ error: "Boleta não informada." }, { status: 400 });

  const before = await db.purchaseTicket.findUnique({
    where: { code },
    include: { items: { select: { externalId: true } } },
  });
  if (!before || before.deletedAt) return NextResponse.json({ error: "Boleta não encontrada." }, { status: 404 });

  const transitions: Record<string, { status: string; action: string }> = {
    submit: { status: "Em aprovação", action: "PURCHASE_TICKET_SUBMITTED" },
    approve: { status: "Aprovada", action: "PURCHASE_TICKET_APPROVED" },
    reject: { status: "Reprovada", action: "PURCHASE_TICKET_REJECTED" },
    cancel: { status: "Cancelada", action: "PURCHASE_TICKET_CANCELLED" },
  };
  const transition = transitions[action];
  if (!transition) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });

  if (action === "submit" && before.status !== "Rascunho") {
    return NextResponse.json({ error: "Somente boletas em rascunho podem ser enviadas para aprovação." }, { status: 409 });
  }
  if ((action === "approve" || action === "reject") && before.status !== "Em aprovação") {
    return NextResponse.json({ error: "Boleta precisa estar em aprovação." }, { status: 409 });
  }
  if (action === "reject" && !notes) {
    return NextResponse.json({ error: "Justificativa é obrigatória para reprovar." }, { status: 400 });
  }

  const ticket = await db.purchaseTicket.update({
    where: { code },
    data: {
      status: transition.status,
      approvalNotes: notes || before.approvalNotes,
      submittedAt: action === "submit" ? new Date() : before.submittedAt,
      reviewedAt: action === "approve" || action === "reject" ? new Date() : before.reviewedAt,
      reviewedById: action === "approve" || action === "reject" ? auth.user.id : before.reviewedById,
    },
    include: { items: { select: { externalId: true } } },
  });

  await writeAudit(db, {
    action: transition.action,
    entityType: "PurchaseTicket",
    entityId: ticket.code,
    userId: auth.user.id,
    before,
    after: ticket,
  });

  return NextResponse.json(mapTicket(ticket));
}
