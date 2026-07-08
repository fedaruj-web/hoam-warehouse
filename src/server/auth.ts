import { createHash, randomUUID } from "crypto";
import type { AppUser } from "@/lib/types";

export const DEMO_PASSWORD = "warehouse";
export const SESSION_COOKIE = "hoam_session";

export function hashPassword(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken() {
  return randomUUID();
}

export function passwordMatches(password: string, storedHash: string) {
  return storedHash === hashPassword(password) || storedHash === "demo-only-change-before-production";
}

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  permissionGroup?: { code: string } | null;
};

export function mapUser(user: AuthUser): AppUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    groupId: user.permissionGroup?.code ?? user.role.toLowerCase(),
    status: user.status === "ACTIVE" ? "Ativo" : user.status === "BLOCKED" ? "Bloqueado" : "Convite pendente",
    lastAccess: "Agora",
  };
}
