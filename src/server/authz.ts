import { cookies } from "next/headers";
import type { PermissionAction, PrismaClient, User } from "@prisma/client";
import { hashToken, SESSION_COOKIE } from "@/server/auth";

const actionMap: Record<string, PermissionAction> = {
  view: "VIEW",
  create: "CREATE",
  update: "UPDATE",
  approve: "APPROVE",
  purchase: "PURCHASE",
  admin: "ADMIN",
};

export type AuthzResult =
  | { ok: true; user: User }
  | { ok: false; status: 401 | 403; error: string; user?: User | null };

export async function requirePermission(
  db: PrismaClient | null,
  module: string,
  action: keyof typeof actionMap,
): Promise<AuthzResult> {
  if (!db) {
    return { ok: true, user: null as unknown as User };
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { ok: false, status: 401, error: "Sessão não encontrada." };

  const session = await db.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.deletedAt) {
    return { ok: false, status: 401, error: "Sessão expirada ou inválida." };
  }

  if (session.user.status !== "ACTIVE") {
    return { ok: false, status: 403, error: "Usuário sem acesso ativo.", user: session.user };
  }

  if (session.user.role === "ADMIN") return { ok: true, user: session.user };
  if (!session.user.permissionGroupId) {
    return { ok: false, status: 403, error: "Usuário sem grupo de permissões.", user: session.user };
  }

  const permission = await db.groupPermission.findUnique({
    where: {
      groupId_module_action: {
        groupId: session.user.permissionGroupId,
        module,
        action: actionMap[action],
      },
    },
  });

  if (!permission?.granted) {
    return { ok: false, status: 403, error: "Permissão insuficiente.", user: session.user };
  }

  return { ok: true, user: session.user };
}
