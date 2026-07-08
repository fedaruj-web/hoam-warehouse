import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { receivablesSeed } from "@/lib/mock-data";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { buildConfirmationEmail, sendConfirmationEmail } from "@/server/email";

function publicOrigin(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(request.url).origin;
}

function confirmationUrl(request: Request, token: string) {
  return `${publicOrigin(request)}/confirmar/${token}`;
}

function mapToken(request: Request, record: {
  token: string;
  expiresAt: Date;
  recipientEmail: string | null;
  emailStatus: string | null;
  emailError: string | null;
  emailSentAt: Date | null;
  emailLastAttemptAt: Date | null;
  emailAttempts: number;
  receivable: { externalId: string };
}) {
  return {
    receivableId: record.receivable.externalId,
    link: confirmationUrl(request, record.token),
    expiresAt: record.expiresAt.toISOString(),
    recipientEmail: record.recipientEmail,
    emailStatus: record.emailStatus,
    emailError: record.emailError,
    emailSentAt: record.emailSentAt?.toISOString() ?? null,
    emailLastAttemptAt: record.emailLastAttemptAt?.toISOString() ?? null,
    emailAttempts: record.emailAttempts,
  };
}

export async function GET(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Confirmação", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json([]);

  const records = await db.confirmationToken.findMany({
    where: {
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      receivable: { deletedAt: null },
    },
    orderBy: { createdAt: "desc" },
    include: { receivable: { select: { externalId: true } } },
  });

  const latestByReceivable = new Map<string, ReturnType<typeof mapToken>>();
  for (const record of records) {
    if (!latestByReceivable.has(record.receivable.externalId)) {
      latestByReceivable.set(record.receivable.externalId, mapToken(request, record));
    }
  }

  return NextResponse.json([...latestByReceivable.values()]);
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Confirmação", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const receivableId = String(body?.receivableId ?? "").trim();
  const expiresInDays = Math.min(Math.max(Number(body?.expiresInDays ?? 7), 1), 30);
  const shouldSendEmail = Boolean(body?.sendEmail);
  const reuseActive = body?.reuseActive !== false;
  const recipientOverride = String(body?.recipientEmail ?? "").trim().toLowerCase();
  if (!receivableId) return NextResponse.json({ error: "Duplicata não informada." }, { status: 400 });

  if (!db) {
    const receivable = receivablesSeed.find((item) => item.id === receivableId);
    if (!receivable) return NextResponse.json({ error: "Duplicata não encontrada." }, { status: 404 });
    const token = randomBytes(24).toString("hex");
    return NextResponse.json({
      token,
      link: confirmationUrl(request, token),
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
      recipientEmail: null,
      email: shouldSendEmail ? { status: "skipped", reason: "Banco indisponível para envio demonstrativo." } : null,
    });
  }

  const receivable = await db.receivable.findUnique({
    where: { externalId: receivableId },
    include: { assignor: true, debtor: true },
  });
  if (!receivable || receivable.deletedAt) return NextResponse.json({ error: "Duplicata não encontrada." }, { status: 404 });
  if (receivable.status === "PURCHASED" || receivable.status === "SETTLED") {
    return NextResponse.json({ error: "Duplicata já comprada ou liquidada não deve gerar nova confirmação." }, { status: 400 });
  }

  const existing = reuseActive
    ? await db.confirmationToken.findFirst({
        where: { receivableId: receivable.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      })
    : null;

  const expiresAt = existing?.expiresAt ?? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  const record =
    existing ??
    (await db.confirmationToken.create({
      data: {
        token: randomBytes(32).toString("base64url"),
        receivableId: receivable.id,
        expiresAt,
        createdById: auth.user.id,
      },
    }));

  const link = confirmationUrl(request, record.token);
  const recipientEmail =
    recipientOverride ||
    receivable.debtor.confirmationEmail?.toLowerCase() ||
    receivable.debtor.financialContactEmail?.toLowerCase() ||
    receivable.debtor.email?.toLowerCase() ||
    "";
  let emailResult: Awaited<ReturnType<typeof sendConfirmationEmail>> | null = null;

  if (shouldSendEmail) {
    if (!recipientEmail) {
      emailResult = { status: "skipped", reason: "Sacado sem e-mail de confirmação cadastrado." };
    } else {
      const email = buildConfirmationEmail({
        assignorName: receivable.assignor.legalName,
        debtorName: receivable.debtor.legalName,
        receivableId: receivable.externalId,
        faceValue: Number(receivable.faceValue).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
        dueDate: receivable.dueDate.toLocaleDateString("pt-BR"),
        link,
        expiresAt,
      });
      emailResult = await sendConfirmationEmail({
        to: recipientEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
        idempotencyKey: `confirmation-${record.id}-${Date.now()}`,
      });
    }

    await db.confirmationToken.update({
      where: { id: record.id },
      data: {
        recipientEmail: recipientEmail || null,
        emailStatus: emailResult.status,
        emailProviderId: emailResult.status === "sent" ? emailResult.providerId : null,
        emailError: emailResult.status === "failed" || emailResult.status === "skipped" ? emailResult.reason : null,
        emailSentAt: emailResult.status === "sent" ? new Date() : undefined,
        emailLastAttemptAt: new Date(),
        emailAttempts: { increment: 1 },
      },
    });
  } else if (recipientEmail && !record.recipientEmail) {
    await db.confirmationToken.update({
      where: { id: record.id },
      data: { recipientEmail },
    });
  }

  await writeAudit(db, {
    action: existing ? "RECEIVABLE_CONFIRMATION_LINK_REUSED" : "RECEIVABLE_CONFIRMATION_LINK_CREATED",
    entityType: "Receivable",
    entityId: receivable.externalId,
    userId: auth.user.id,
    after: {
      tokenId: record.id,
      expiresAt,
      debtor: receivable.debtor.legalName,
      assignor: receivable.assignor.legalName,
      recipientEmail: recipientEmail || null,
    },
  });

  if (emailResult) {
    await writeAudit(db, {
      action: emailResult.status === "sent" ? "RECEIVABLE_CONFIRMATION_EMAIL_SENT" : "RECEIVABLE_CONFIRMATION_EMAIL_NOT_SENT",
      entityType: "Receivable",
      entityId: receivable.externalId,
      userId: auth.user.id,
      after: {
        tokenId: record.id,
        recipientEmail: recipientEmail || null,
        email: emailResult,
      },
    });
  }

  return NextResponse.json(
    {
      token: record.token,
      link,
      expiresAt: expiresAt.toISOString(),
      recipientEmail: recipientEmail || null,
      reused: Boolean(existing),
      email: emailResult,
    },
    { status: existing ? 200 : 201 },
  );
}
