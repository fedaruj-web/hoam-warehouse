import { NextResponse } from "next/server";
import { groupsSeed } from "@/lib/mock-data";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapAccessGroup, uiToPrismaAction } from "@/server/access";
import type { PermissionAction } from "@/lib/types";

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Usuários", "admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json(groupsSeed);

  const groups = await db.permissionGroup.findMany({
    where: { deletedAt: null, active: true },
    include: {
      users: { where: { deletedAt: null }, select: { id: true } },
      permissions: true,
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(groups.map(mapAccessGroup));
}

export async function PATCH(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Usuários", "admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const groupCode = String(body?.groupId ?? "").trim();
  const moduleName = String(body?.module ?? "").trim();
  const action = String(body?.action ?? "").trim() as PermissionAction;

  if (!groupCode || !moduleName || !uiToPrismaAction[action]) {
    return NextResponse.json({ error: "Permissão inválida." }, { status: 400 });
  }
  if (groupCode === "admin") return NextResponse.json({ error: "Perfil administrador é protegido." }, { status: 400 });

  if (!db) return NextResponse.json({ ok: true });

  const group = await db.permissionGroup.findUnique({ where: { code: groupCode } });
  if (!group || group.deletedAt || !group.active) {
    return NextResponse.json({ error: "Grupo de permissões inválido." }, { status: 400 });
  }

  const prismaAction = uiToPrismaAction[action];
  const existing = await db.groupPermission.findUnique({
    where: { groupId_module_action: { groupId: group.id, module: moduleName, action: prismaAction } },
  });
  const updated = existing
    ? await db.groupPermission.update({ where: { id: existing.id }, data: { granted: !existing.granted } })
    : await db.groupPermission.create({ data: { groupId: group.id, module: moduleName, action: prismaAction, granted: true } });

  await writeAudit(db, {
    action: "PERMISSION_UPDATED",
    entityType: "PermissionGroup",
    entityId: group.code,
    userId: auth.user.id,
    after: { module: moduleName, action, granted: updated.granted },
  });

  const refreshed = await db.permissionGroup.findUnique({
    where: { id: group.id },
    include: {
      users: { where: { deletedAt: null }, select: { id: true } },
      permissions: true,
    },
  });

  return NextResponse.json(refreshed ? mapAccessGroup(refreshed) : { ok: true });
}
