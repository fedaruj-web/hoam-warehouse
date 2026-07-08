import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { PermissionAction, UserStatus } from "@prisma/client";
import { hashPassword } from "@/server/auth";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapAssignor } from "@/server/entities";
import { buildUserInviteEmail, sendUserInviteEmail } from "@/server/email";

function provisionalPassword(email: string) {
  return `HOAM-${email.split("@")[0].slice(0, 4)}-2026!`;
}

function publicOrigin(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(request.url).origin;
}

function inviteUrl(request: Request, token: string) {
  return `${publicOrigin(request)}/convite/${token}`;
}

const portalModules = ["Dashboard", "Cedentes", "Sacados", "Importação", "Elegibilidade", "Compra", "Carteira", "Documentos", "Relatórios", "Usuários", "Audit log"];
const portalActions = [PermissionAction.VIEW, PermissionAction.CREATE, PermissionAction.UPDATE, PermissionAction.APPROVE, PermissionAction.PURCHASE, PermissionAction.ADMIN];
const portalGranted = new Set(["Cedentes:VIEW", "Documentos:VIEW", "Documentos:CREATE"]);

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Cedentes", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const assignorId = String(body?.assignorId ?? "").trim();
  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const roleLabel = String(body?.role ?? "Representante do cedente").trim();
  const statusLabel = String(body?.status ?? "Convite pendente").trim();

  if (!assignorId) return NextResponse.json({ error: "Cedente não informado." }, { status: 400 });
  if (name.length < 3) return NextResponse.json({ error: "Nome deve ter ao menos 3 caracteres." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  const status = statusLabel === "Ativo" ? UserStatus.ACTIVE : UserStatus.INVITED;

  if (!db) {
    return NextResponse.json({
      id: assignorId,
      portalUsers: [{ id: `USR-${Date.now()}`, name, email, status: statusLabel, role: roleLabel, createdAt: new Date().toLocaleDateString("pt-BR") }],
    }, { status: 201 });
  }

  const assignor = await db.assignor.findUnique({ where: { code: assignorId } });
  if (!assignor || assignor.deletedAt) return NextResponse.json({ error: "Cedente não encontrado." }, { status: 404 });

  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: "Já existe um usuário com este e-mail. Reative ou altere o cadastro existente." }, { status: 409 });
  }

  const group = await db.permissionGroup.upsert({
    where: { code: "cedente-externo" },
    update: { active: true, deletedAt: null },
    create: {
      code: "cedente-externo",
      name: "Cedente externo",
      description: "Acesso restrito para representantes de cedentes enviarem documentos, termos e assinaturas.",
      system: true,
    },
  });
  await Promise.all(
    portalModules.flatMap((module) =>
      portalActions.map((action) =>
        db.groupPermission.upsert({
          where: { groupId_module_action: { groupId: group.id, module, action } },
          update: { granted: portalGranted.has(`${module}:${action}`) },
          create: {
            groupId: group.id,
            module,
            action,
            granted: portalGranted.has(`${module}:${action}`),
          },
        }),
      ),
    ),
  );

  const user = await db.user.create({
    data: {
      name,
      email,
      passwordHash: hashPassword(String(body?.password ?? provisionalPassword(email))),
      status,
      role: "VIEWER",
      permissionGroupId: group.id,
      assignorId: assignor.id,
    },
  });

  await writeAudit(db, {
    action: "ASSIGNOR_PORTAL_USER_INVITED",
    entityType: "Assignor",
    entityId: assignor.code,
    userId: auth.user.id,
    after: { assignor: assignor.code, user: { id: user.id, email: user.email, roleLabel, status } },
  });

  if (user.status === "INVITED") {
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
      groupName: "Cedente externo",
      link: inviteUrl(request, invite.token),
      expiresAt,
    });
    const emailResult = await sendUserInviteEmail({
      to: user.email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      idempotencyKey: `assignor-portal-invite/${invite.id}`,
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
      action: emailResult.status === "sent" ? "USER_INVITE_EMAIL_SENT" : "USER_INVITE_EMAIL_NOT_SENT",
      entityType: "User",
      entityId: user.id,
      userId: auth.user.id,
      after: { assignor: assignor.code, userEmail: user.email, inviteId: invite.id, email: emailResult },
    });
  }

  const updated = await db.assignor.findUniqueOrThrow({
    where: { code: assignorId },
    include: { portalUsers: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } } },
  });

  return NextResponse.json(mapAssignor(updated), { status: 201 });
}
