import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { buildUserInviteEmail, sendUserInviteEmail } from "@/server/email";

type Context = { params: Promise<{ id: string }> };

function publicOrigin(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(request.url).origin;
}

function inviteUrl(request: Request, token: string) {
  return `${publicOrigin(request)}/convite/${token}`;
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const db = getDbOrNull();
  const auth = await requirePermission(db, "UsuÃ¡rios", "admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const user = await db.user.findUnique({
    where: { id },
    include: { permissionGroup: { select: { name: true } } },
  });
  if (!user || user.deletedAt) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  if (user.status === "BLOCKED" || user.status === "INACTIVE") {
    return NextResponse.json({ error: "Usuário bloqueado ou inativo não pode receber convite." }, { status: 400 });
  }

  await db.userInviteToken.updateMany({
    where: { userId: user.id, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  const invite = await db.userInviteToken.create({
    data: {
      token: randomBytes(32).toString("base64url"),
      userId: user.id,
      createdById: auth.user.id,
      expiresAt,
    },
  });

  const emailContent = buildUserInviteEmail({
    name: user.name,
    email: user.email,
    groupName: user.permissionGroup?.name ?? "Perfil de acesso",
    link: inviteUrl(request, invite.token),
    expiresAt,
  });
  const emailResult = await sendUserInviteEmail({
    to: user.email,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
    idempotencyKey: `user-invite/${invite.id}`,
  });

  await db.userInviteToken.update({
    where: { id: invite.id },
    data: {
      emailStatus: emailResult.status,
      emailProviderId: emailResult.status === "sent" ? emailResult.providerId : null,
      emailError: emailResult.status === "sent" ? null : emailResult.reason,
      emailSentAt: emailResult.status === "sent" ? new Date() : null,
      emailLastAttemptAt: new Date(),
      emailAttempts: { increment: 1 },
    },
  });

  await writeAudit(db, {
    action: emailResult.status === "sent" ? "USER_INVITE_EMAIL_RESENT" : "USER_INVITE_EMAIL_NOT_SENT",
    entityType: "User",
    entityId: user.id,
    userId: auth.user.id,
    after: { userEmail: user.email, inviteId: invite.id, email: emailResult },
  });

  return NextResponse.json({
    expiresAt: expiresAt.toISOString(),
    link: inviteUrl(request, invite.token),
    email: emailResult,
  });
}
