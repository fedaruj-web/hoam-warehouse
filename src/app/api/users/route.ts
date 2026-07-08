import { NextResponse } from "next/server";
import { usersSeed } from "@/lib/mock-data";
import type { AppUser } from "@/lib/types";
import { hashPassword } from "@/server/auth";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapAppUser } from "@/server/access";

const statusToPrisma: Record<AppUser["status"], "ACTIVE" | "INVITED" | "BLOCKED"> = {
  Ativo: "ACTIVE",
  "Convite pendente": "INVITED",
  Bloqueado: "BLOCKED",
};

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

  return NextResponse.json(mapAppUser(created), { status: 201 });
}
