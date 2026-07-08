import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const demoPasswordHash = "ae1fd358c7612a02fdc6d923fd40308ebefb0e954c7ddb6f9a8bcdd1f3b00c3b";

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
    description: "ImportaÃ§Ã£o, compra de ativos e gestÃ£o operacional da carteira.",
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

const modules = [
  "Dashboard",
  "Cedentes",
  "Sacados",
  "ImportaÃ§Ã£o",
  "Elegibilidade",
  "Compra",
  "Carteira",
  "Documentos",
  "RelatÃ³rios",
  "UsuÃ¡rios",
  "Audit log",
];

const actions = ["VIEW", "CREATE", "UPDATE", "APPROVE", "PURCHASE", "ADMIN"];

const users = [
  ["Felipe Martins", "felipe@hoam.com.br", "admin"],
  ["Marina Andrade", "marina@hoam.com.br", "credito"],
  ["Rafael Nogueira", "rafael@hoam.com.br", "operacoes"],
  ["ComitÃª HOAM", "comite@hoam.com.br", "comite"],
];

const assignors = [
  ["CED-001", "Alvorada Alimentos S.A.", "12.345.678/0001-90", "Alimentos", 12_500_000, "ACTIVE"],
  ["CED-002", "Nexum Tecnologia Ltda.", "28.456.789/0001-12", "Tecnologia", 6_800_000, "ACTIVE"],
  ["CED-003", "Grupo Monte Azul", "07.654.321/0001-45", "LogÃ­stica", 9_200_000, "REVIEW"],
  ["CED-004", "VÃ©rtice IndÃºstria S.A.", "51.100.700/0001-22", "IndÃºstria", 15_000_000, "ACTIVE"],
];

const debtors = [
  ["SAC-182", "Rede Nacional de Varejo S.A.", "44.123.876/0001-02", "AA", 3_840_000, "ACTIVE"],
  ["SAC-144", "Distribuidora Horizonte Ltda.", "19.882.210/0001-65", "A", 2_260_000, "ACTIVE"],
  ["SAC-097", "Mercantil Paulista S.A.", "03.448.760/0001-19", "BBB", 1_180_000, "REVIEW"],
  ["SAC-211", "Comercial Aurora Ltda.", "08.271.332/0001-75", "A", 728_000, "ACTIVE"],
];

async function main() {
  for (const group of groups) {
    await prisma.permissionGroup.upsert({
      where: { code: group.code },
      update: group,
      create: group,
    });
  }

  const groupByCode = Object.fromEntries(
    (await prisma.permissionGroup.findMany()).map((group) => [group.code, group]),
  );

  for (const moduleName of modules) {
    for (const action of actions) {
      await prisma.groupPermission.upsert({
        where: {
          groupId_module_action: {
            groupId: groupByCode.admin.id,
            module: moduleName,
            action,
          },
        },
        update: { granted: true },
        create: {
          groupId: groupByCode.admin.id,
          module: moduleName,
          action,
          granted: true,
        },
      });
    }
  }

  const externalPermissions = {
    Cedentes: ["VIEW"],
    Documentos: ["VIEW", "CREATE"],
  };
  for (const moduleName of modules) {
    for (const action of actions) {
      const granted = externalPermissions[moduleName]?.includes(action) ?? false;
      await prisma.groupPermission.upsert({
        where: {
          groupId_module_action: {
            groupId: groupByCode["cedente-externo"].id,
            module: moduleName,
            action,
          },
        },
        update: { granted },
        create: {
          groupId: groupByCode["cedente-externo"].id,
          module: moduleName,
          action,
          granted,
        },
      });
    }
  }

  for (const [name, email, groupCode] of users) {
    await prisma.user.upsert({
      where: { email },
      update: {
        name,
        status: "ACTIVE",
        permissionGroupId: groupByCode[groupCode].id,
      },
      create: {
        name,
        email,
        passwordHash: demoPasswordHash,
        status: "ACTIVE",
        role: groupCode === "admin" ? "ADMIN" : "VIEWER",
        permissionGroupId: groupByCode[groupCode].id,
      },
    });
  }

  for (const [code, legalName, taxId, sector, creditLimit, status] of assignors) {
    await prisma.assignor.upsert({
      where: { code },
      update: { legalName, taxId, sector, creditLimit, status },
      create: { code, legalName, taxId, sector, creditLimit, status },
    });
  }

  for (const [code, legalName, taxId, rating, exposureLimit, status] of debtors) {
    await prisma.debtor.upsert({
      where: { code },
      update: { legalName, taxId, rating, exposureLimit, status },
      create: { code, legalName, taxId, rating, exposureLimit, status },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

