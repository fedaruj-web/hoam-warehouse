import type { Prisma, PrismaClient } from "@prisma/client";

export const DEFAULT_CASH_ACCOUNTS = {
  PURCHASE_SETTLEMENT: {
    code: "CTA-WH-COMPRA",
    name: "Warehouse · Liquidação de compras",
    accountType: "Conta movimento",
    purpose: "PURCHASE_SETTLEMENT",
  },
  RECEIVABLE_COLLECTION: {
    code: "CTA-WH-RECEB",
    name: "Warehouse · Recebimentos de sacados",
    accountType: "Conta recebimento",
    purpose: "RECEIVABLE_COLLECTION",
  },
  RESERVE: {
    code: "CTA-WH-RESERVA",
    name: "Warehouse · Reserva operacional",
    accountType: "Conta reserva",
    purpose: "RESERVE",
  },
} as const;

type Db = PrismaClient | Prisma.TransactionClient;
type CashPurpose = keyof typeof DEFAULT_CASH_ACCOUNTS;

export async function ensureDefaultCashAccounts(db: Db) {
  for (const account of Object.values(DEFAULT_CASH_ACCOUNTS)) {
    await db.cashAccount.upsert({
      where: { code: account.code },
      update: { deletedAt: null, status: "Ativa" },
      create: {
        ...account,
        currency: "BRL",
        openingBalance: 0,
        status: "Ativa",
      },
    });
  }
}

export async function getOperationalCashAccount(db: Db, purpose: CashPurpose, code?: string | null) {
  if (code) {
    const account = await db.cashAccount.findUnique({ where: { code } });
    if (account && !account.deletedAt && account.status === "Ativa") return account;
  }

  const defaults = DEFAULT_CASH_ACCOUNTS[purpose];
  return db.cashAccount.upsert({
    where: { code: defaults.code },
    update: { deletedAt: null, status: "Ativa" },
    create: {
      ...defaults,
      currency: "BRL",
      openingBalance: 0,
      status: "Ativa",
    },
  });
}
