import { NextResponse } from "next/server";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";

type OperationRecord = {
  code: string;
  title: string;
  status: string;
  currentStep: string;
  faceValue: unknown;
  purchaseValue: unknown;
  readyCount: number;
  blockedCount: number;
  createdAt: Date;
  updatedAt: Date;
  events?: {
    id: string;
    step: string;
    action: string;
    notes: string | null;
    createdAt: Date;
  }[];
};

function money(value: unknown) {
  return Number(value ?? 0);
}

function mapOperation(item: OperationRecord) {
  return {
    id: item.code,
    title: item.title,
    status: item.status,
    currentStep: item.currentStep,
    faceValue: money(item.faceValue),
    purchaseValue: money(item.purchaseValue),
    readyCount: item.readyCount,
    blockedCount: item.blockedCount,
    createdAt: item.createdAt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    updatedAt: item.updatedAt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    events: (item.events ?? []).map((event) => ({
      id: event.id,
      step: event.step,
      action: event.action,
      notes: event.notes,
      at: event.createdAt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    })),
  };
}

function nextCode() {
  return `CESS-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
}

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Compra", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json([]);

  const operations = await db.cessionOperation.findMany({
    where: { deletedAt: null },
    include: { events: { orderBy: { createdAt: "desc" }, take: 8 } },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  return NextResponse.json(operations.map(mapOperation));
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Compra", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const title = String(body?.title ?? "Jornada de cessão warehouse").trim();
  const currentStep = String(body?.currentStep ?? "Simulação").trim();
  const status = String(body?.status ?? "Simulação").trim();
  const faceValue = Number(body?.faceValue ?? 0);
  const purchaseValue = Number(body?.purchaseValue ?? 0);
  const readyCount = Number(body?.readyCount ?? 0);
  const blockedCount = Number(body?.blockedCount ?? 0);

  const operation = await db.cessionOperation.create({
    data: {
      code: nextCode(),
      title,
      status,
      currentStep,
      faceValue,
      purchaseValue,
      readyCount,
      blockedCount,
      snapshot: body?.snapshot ?? undefined,
      createdById: auth.user.id,
      events: {
        create: {
          step: currentStep,
          action: "CESSION_OPERATION_CREATED",
          notes: "Operação criada a partir da jornada guiada.",
          payload: body?.snapshot ?? undefined,
          createdById: auth.user.id,
        },
      },
    },
    include: { events: { orderBy: { createdAt: "desc" }, take: 8 } },
  });

  await writeAudit(db, {
    action: "CESSION_OPERATION_CREATED",
    entityType: "CessionOperation",
    entityId: operation.code,
    userId: auth.user.id,
    after: { code: operation.code, status, currentStep, faceValue, purchaseValue, readyCount, blockedCount },
  });

  return NextResponse.json(mapOperation(operation), { status: 201 });
}

export async function PATCH(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Compra", "update");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const code = String(body?.id ?? body?.code ?? "").trim();
  const status = String(body?.status ?? "").trim();
  const currentStep = String(body?.currentStep ?? "").trim();
  const notes = String(body?.notes ?? "").trim();
  if (!code) return NextResponse.json({ error: "Operação não informada." }, { status: 400 });
  if (!status && !currentStep) return NextResponse.json({ error: "Informe status ou etapa." }, { status: 400 });

  const before = await db.cessionOperation.findUnique({ where: { code } });
  if (!before || before.deletedAt) return NextResponse.json({ error: "Operação não encontrada." }, { status: 404 });

  const operation = await db.cessionOperation.update({
    where: { code },
    data: {
      status: status || before.status,
      currentStep: currentStep || before.currentStep,
      closedAt: status === "Concluída" || status === "Cancelada" ? new Date() : undefined,
      events: {
        create: {
          step: currentStep || before.currentStep,
          action: "CESSION_OPERATION_UPDATED",
          notes: notes || `Status atualizado para ${status || before.status}.`,
          payload: { fromStatus: before.status, toStatus: status || before.status, fromStep: before.currentStep, toStep: currentStep || before.currentStep },
          createdById: auth.user.id,
        },
      },
    },
    include: { events: { orderBy: { createdAt: "desc" }, take: 8 } },
  });

  await writeAudit(db, {
    action: "CESSION_OPERATION_UPDATED",
    entityType: "CessionOperation",
    entityId: operation.code,
    userId: auth.user.id,
    before: { status: before.status, currentStep: before.currentStep },
    after: { status: operation.status, currentStep: operation.currentStep, notes },
  });

  return NextResponse.json(mapOperation(operation));
}
