import { createHash } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const adminEmail = (process.env.ADMIN_MASTER_EMAIL ?? "admin-master@hoam.com.br").toLowerCase();
const adminPassword = process.env.ADMIN_MASTER_PASSWORD ?? "AdminMaster@2026!";

const modules = [
  "Dashboard",
  "Alertas",
  "Esteira",
  "Cedentes",
  "Sacados",
  "ImportaÃ§Ã£o",
  "ConfirmaÃ§Ã£o",
  "Elegibilidade",
  "Risco",
  "ComitÃª",
  "Compra",
  "Carteira",
  "Caixa",
  "CobranÃ§a",
  "Funding",
  "Documentos",
  "RelatÃ³rios",
  "UsuÃ¡rios",
  "Audit log",
];

const actions = ["VIEW", "CREATE", "UPDATE", "APPROVE", "PURCHASE", "ADMIN"];

const groups = [
  {
    code: "admin",
    name: "Administrador",
    description: "Acesso completo Ã  plataforma, usuÃ¡rios, permissÃµes e audit log.",
    system: true,
  },
  {
    code: "credito",
    name: "CrÃ©dito",
    description: "AnÃ¡lise de cedentes, sacados e motor de elegibilidade.",
  },
  {
    code: "operacoes",
    name: "OperaÃ§Ãµes",
    description: "ImportaÃ§Ã£o, compra de ativos, cobranÃ§a e gestÃ£o operacional da carteira.",
  },
  {
    code: "comite",
    name: "ComitÃª",
    description: "VisÃ£o executiva e aprovaÃ§Ã£o de exceÃ§Ãµes.",
  },
  {
    code: "consulta",
    name: "Consulta",
    description: "Acesso somente leitura para acompanhamento e relatÃ³rios.",
  },
  {
    code: "cedente-externo",
    name: "Cedente externo",
    description: "Acesso restrito para representantes de cedentes enviarem documentos, termos e assinaturas.",
    system: true,
  },
];

const groupPermissionMatrix = {
  admin: Object.fromEntries(modules.map((moduleName) => [moduleName, actions])),
  credito: {
    Dashboard: ["VIEW"],
    Cedentes: ["VIEW", "CREATE", "UPDATE", "APPROVE"],
    Sacados: ["VIEW", "CREATE", "UPDATE", "APPROVE"],
    Elegibilidade: ["VIEW", "APPROVE"],
    Risco: ["VIEW"],
    "ComitÃª": ["VIEW"],
    "RelatÃ³rios": ["VIEW"],
    "Audit log": ["VIEW"],
  },
  operacoes: {
    Dashboard: ["VIEW"],
    Cedentes: ["VIEW"],
    Sacados: ["VIEW"],
    "ImportaÃ§Ã£o": ["VIEW", "CREATE"],
    "ConfirmaÃ§Ã£o": ["VIEW", "CREATE", "UPDATE"],
    Elegibilidade: ["VIEW"],
    "ComitÃª": ["VIEW"],
    Compra: ["VIEW", "PURCHASE"],
    Carteira: ["VIEW", "CREATE"],
    Caixa: ["VIEW", "CREATE", "UPDATE"],
    "CobranÃ§a": ["VIEW", "CREATE", "UPDATE"],
    Funding: ["VIEW", "CREATE", "UPDATE"],
    Documentos: ["VIEW", "CREATE", "UPDATE"],
    "RelatÃ³rios": ["VIEW"],
  },
  comite: {
    Dashboard: ["VIEW"],
    Cedentes: ["VIEW"],
    Sacados: ["VIEW"],
    Elegibilidade: ["VIEW", "APPROVE"],
    "ComitÃª": ["VIEW", "APPROVE"],
    Compra: ["VIEW", "APPROVE"],
    Carteira: ["VIEW"],
    Caixa: ["VIEW"],
    "CobranÃ§a": ["VIEW"],
    Funding: ["VIEW"],
    "RelatÃ³rios": ["VIEW"],
    "Audit log": ["VIEW"],
  },
  consulta: Object.fromEntries(modules.map((moduleName) => [moduleName, ["VIEW"]])),
  "cedente-externo": {
    Cedentes: ["VIEW"],
    Documentos: ["VIEW", "CREATE"],
  },
};

function hashPassword(password) {
  return createHash("sha256").update(password).digest("hex");
}

async function clearData() {
  await prisma.$transaction([
    prisma.eligibilityEvaluation.deleteMany(),
    prisma.workflowTransition.deleteMany(),
    prisma.purchaseItem.deleteMany(),
    prisma.settlement.deleteMany(),
    prisma.portfolioItem.deleteMany(),
    prisma.document.deleteMany(),
    prisma.bankStatementEntry.deleteMany(),
    prisma.cashMovement.deleteMany(),
    prisma.cashAccount.deleteMany(),
    prisma.fundingIssue.deleteMany(),
    prisma.purchase.deleteMany(),
    prisma.receivable.deleteMany(),
    prisma.importBatch.deleteMany(),
    prisma.eligibilityRule.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.userSession.deleteMany(),
    prisma.user.deleteMany(),
    prisma.assignor.deleteMany(),
    prisma.debtor.deleteMany(),
    prisma.groupPermission.deleteMany(),
    prisma.permissionGroup.deleteMany(),
  ]);
}

async function createAccessModel() {
  await prisma.permissionGroup.createMany({ data: groups });

  const groupByCode = Object.fromEntries((await prisma.permissionGroup.findMany()).map((group) => [group.code, group]));
  const permissions = [];

  for (const [groupCode, modulePermissions] of Object.entries(groupPermissionMatrix)) {
    const group = groupByCode[groupCode];
    for (const [moduleName, grantedActions] of Object.entries(modulePermissions)) {
      for (const action of actions) {
        permissions.push({
          groupId: group.id,
          module: moduleName,
          action,
          granted: grantedActions.includes(action),
        });
      }
    }
  }
  await prisma.groupPermission.createMany({ data: permissions });

  const adminGroup = groupByCode.admin;
  const admin = await prisma.user.create({
    data: {
      name: "Admin Master",
      email: adminEmail,
      passwordHash: hashPassword(adminPassword),
      role: "ADMIN",
      status: "ACTIVE",
      permissionGroupId: adminGroup.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "TEST_DATABASE_RESET",
      entityType: "Database",
      entityId: "test",
      after: { adminEmail, groups: groups.map((group) => group.code) },
    },
  });
}

async function main() {
  await clearData();
  await createAccessModel();
  const counts = {
    users: await prisma.user.count(),
    groups: await prisma.permissionGroup.count(),
    permissions: await prisma.groupPermission.count(),
    assignors: await prisma.assignor.count(),
    debtors: await prisma.debtor.count(),
    receivables: await prisma.receivable.count(),
    auditLogs: await prisma.auditLog.count(),
  };
  console.log(JSON.stringify({ adminEmail, counts }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });



