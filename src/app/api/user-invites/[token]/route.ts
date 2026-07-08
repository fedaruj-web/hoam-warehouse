import { NextResponse } from "next/server";
import { hashPassword } from "@/server/auth";
import { writeAudit } from "@/server/audit";
import { getDbOrNull } from "@/server/db";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  const { token } = await context.params;
  const db = getDbOrNull();
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const invite = await db.userInviteToken.findUnique({
    where: { token },
    include: {
      user: {
        select: {
          name: true,
          email: true,
          status: true,
          deletedAt: true,
          permissionGroup: { select: { name: true } },
        },
      },
    },
  });

  if (!invite || invite.revokedAt || invite.usedAt || invite.expiresAt <= new Date() || invite.user.deletedAt) {
    return NextResponse.json({ error: "Convite inválido ou expirado." }, { status: 404 });
  }

  return NextResponse.json({
    name: invite.user.name,
    email: invite.user.email,
    status: invite.user.status,
    groupName: invite.user.permissionGroup?.name ?? "Perfil de acesso",
    expiresAt: invite.expiresAt.toISOString(),
  });
}

export async function POST(request: Request, context: Context) {
  const { token } = await context.params;
  const db = getDbOrNull();
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const password = String(body?.password ?? "");
  const passwordConfirm = String(body?.passwordConfirm ?? "");

  if (password.length < 8) return NextResponse.json({ error: "A senha deve ter ao menos 8 caracteres." }, { status: 400 });
  if (password !== passwordConfirm) return NextResponse.json({ error: "As senhas não conferem." }, { status: 400 });

  const invite = await db.userInviteToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!invite || invite.revokedAt || invite.usedAt || invite.expiresAt <= new Date() || invite.user.deletedAt) {
    return NextResponse.json({ error: "Convite inválido ou expirado." }, { status: 404 });
  }

  const updated = await db.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: invite.userId },
      data: {
        passwordHash: hashPassword(password),
        status: "ACTIVE",
      },
      select: { id: true, name: true, email: true, status: true },
    });
    await tx.userInviteToken.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    });
    await writeAudit(tx, {
      action: "USER_INVITE_ACCEPTED",
      entityType: "User",
      entityId: user.id,
      after: { email: user.email, inviteId: invite.id, status: user.status },
    });
    return user;
  });

  return NextResponse.json({ ok: true, user: updated });
}
