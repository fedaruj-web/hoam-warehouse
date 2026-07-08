import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { usersSeed } from "@/lib/mock-data";
import type { AppUser } from "@/lib/types";
import { hashPassword } from "@/server/auth";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { buildUserInviteEmail, sendUserInviteEmail } from "@/server/email";
import { mapAppUser } from "@/server/access";

const statusToPrisma: Record<AppUser["status"], "ACTIVE" | "INVITED" | "BLOCKED"> = {
  Ativo: "ACTIVE",
  "Convite pendente": "INVITED",
  Bloqueado: "BLOCKED",
};

function publicOrigin(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(request.url).origin;
}

function inviteUrl(request: Request, token: string) {
  return `${publicOrigin(request)}/convite/${token}`;
}

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Usuários", "admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json(usersSeed);

  const users = await db.user.findMany({
    where: { deletedAt: null },
    include: { permissionGroup: { select: { code: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(users.map(mapAppUser));
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Usuários", "admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? body?.nome ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const groupCode = String(body?.groupId ?? body?.group ?? "").trim();
  const status = String(body?.status ?? "Convite pendente") as AppUser["status"];
  const password = String(body?.password ?? "").trim();

  if (name.length < 3) return NextResponse.json({ error: "Nome deve ter ao menos 3 caracteres." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  if (!groupCode) return NextResponse.json({ error: "Grupo de permissões é obrigatório." }, { status: 400 });
  if (!statusToPrisma[status]) return NextResponse.json({ error: "Status inválido." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Senha provisória deve ter ao menos 8 caracteres." }, { status: 400 });

  if (!db) {
    return NextResponse.json({
      id: `USR-${Date.now()}`,
      name,
      email,
      groupId: groupCode,
      status,
      lastAccess: "Nunca",
    } satisfies AppUser, { status: 201 });
  }

  const group = await db.permissionGroup.findUnique({ where: { code: groupCode } });
  if (!group || group.deletedAt || !group.active) {
    return NextResponse.json({ error: "Grupo de permissões inválido." }, { status: 400 });
  }

  const created = await db.user.create({
    data: {
      name,
      email,
      passwordHash: hashPassword(password),
      status: statusToPrisma[status],
      role: group.code === "admin" ? "ADMIN" : "VIEWER",
      permissionGroupId: group.id,
    },
    include: { permissionGroup: { select: { code: true } } },
  });

  await writeAudit(db, {
    action: "USER_CREATED",
    entityType: "User",
    entityId: created.id,
    userId: auth.user.id,
    after: { id: created.id, email: created.email, group: group.code, status: created.status },
  });

  let inviteResult: Awaited<ReturnType<typeof sendUserInviteEmail>> | null = null;
  if (created.status === "INVITED") {
    await db.userInviteToken.updateMany({
      where: { userId: created.id, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
    const invite = await db.userInviteToken.create({
      data: {
        token: randomBytes(32).toString("base64url"),
        userId: created.id,
        createdById: auth.user.id,
        expiresAt,
      },
    });
    const emailContent = buildUserInviteEmail({
      name: created.name,
      email: created.email,
      groupName: group.name,
      link: inviteUrl(request, invite.token),
      expiresAt,
    });
    inviteResult = await sendUserInviteEmail({
      to: created.email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      idempotencyKey: `user-invite/${invite.id}`,
    });
    await db.userInviteToken.update({
      where: { id: invite.id },
      data: {
        emailStatus: inviteResult.status,
        emailProviderId: inviteResult.status === "sent" ? inviteResult.providerId : null,
        emailError: inviteResult.status === "sent" ? null : inviteResult.reason,
        emailSentAt: inviteResult.status === "sent" ? new Date() : null,
        emailLastAttemptAt: new Date(),
        emailAttempts: { increment: 1 },
      },
    });
    await writeAudit(db, {
      action: inviteResult.status === "sent" ? "USER_INVITE_EMAIL_SENT" : "USER_INVITE_EMAIL_NOT_SENT",
      entityType: "User",
      entityId: created.id,
      userId: auth.user.id,
      after: { userEmail: created.email, inviteId: invite.id, email: inviteResult },
    });
  }

  return NextResponse.json({ ...mapAppUser(created), inviteEmail: inviteResult }, { status: 201 });
}
