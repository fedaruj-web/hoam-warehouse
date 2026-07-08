import type { Prisma, PrismaClient } from "@prisma/client";

type AuditPayload = {
  action: string;
  entityType: string;
  entityId: string;
  userId?: string | null;
  before?: unknown;
  after?: unknown;
};

export async function writeAudit(db: PrismaClient | Prisma.TransactionClient | null, payload: AuditPayload) {
  if (!db) return;

  await db.auditLog.create({
    data: {
      action: payload.action,
      entityType: payload.entityType,
      entityId: payload.entityId,
      userId: payload.userId ?? null,
      before: payload.before === undefined ? undefined : JSON.parse(JSON.stringify(payload.before)),
      after: payload.after === undefined ? undefined : JSON.parse(JSON.stringify(payload.after)),
    },
  });
}
