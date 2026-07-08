import type { AccessGroup, AppUser, PermissionAction, PermissionMap } from "@/lib/types";
import type { PermissionAction as PrismaPermissionAction } from "@prisma/client";
import { actions, modules } from "@/lib/mock-data";

type PrismaGroup = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  users?: { id: string }[];
  permissions?: { module: string; action: string; granted: boolean }[];
};

type PrismaUser = {
  id: string;
  name: string;
  email: string;
  status: string;
  permissionGroup?: { code: string } | null;
};

const actionToUi: Record<string, PermissionAction> = {
  VIEW: "view",
  CREATE: "create",
  UPDATE: "create",
  APPROVE: "approve",
  PURCHASE: "purchase",
  ADMIN: "admin",
};

export const uiToPrismaAction: Record<PermissionAction, PrismaPermissionAction> = {
  view: "VIEW",
  create: "CREATE",
  approve: "APPROVE",
  purchase: "PURCHASE",
  admin: "ADMIN",
};

export function mapAccessGroup(group: PrismaGroup): AccessGroup {
  const permissions = Object.fromEntries(modules.map((moduleName) => [moduleName, [] as PermissionAction[]])) as PermissionMap;
  for (const permission of group.permissions ?? []) {
    const action = actionToUi[permission.action];
    if (!permission.granted || !action) continue;
    const current = permissions[permission.module] ?? [];
    if (!current.includes(action)) permissions[permission.module] = [...current, action];
  }

  if (group.code === "admin") {
    for (const moduleName of modules) permissions[moduleName] = actions.map((action) => action.key);
  }

  return {
    id: group.code,
    name: group.name,
    description: group.description ?? "",
    users: group.users?.length ?? 0,
    permissions,
  };
}

export function mapAppUser(user: PrismaUser): AppUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    groupId: user.permissionGroup?.code ?? "consulta",
    status: user.status === "ACTIVE" ? "Ativo" : user.status === "BLOCKED" ? "Bloqueado" : "Convite pendente",
    lastAccess: "Nunca",
  };
}
