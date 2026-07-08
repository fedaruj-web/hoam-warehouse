import { getPrisma } from "@/lib/prisma";

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

export function getDbOrNull() {
  if (!hasDatabaseUrl()) return null;
  return getPrisma();
}

