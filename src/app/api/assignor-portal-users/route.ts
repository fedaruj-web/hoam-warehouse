import { NextResponse } from "next/server";
import { PermissionAction, UserStatus } from "@prisma/client";
import { hashPassword } from "@/server/auth";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapAssignor } from "@/server/entities";

function provisionalPassword(email: string) {
  return `HOAM-${email.split("@")[0].slice(0, 4)}-2026!`;
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

  const updated = await db.assignor.findUniqueOrThrow({
    where: { code: assignorId },
    include: { portalUsers: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } } },
  });

  return NextResponse.json(mapAssignor(updated), { status: 201 });
}
