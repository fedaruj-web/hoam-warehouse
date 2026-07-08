import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { assignorsSeed } from "@/lib/mock-data";
import { parseAssignorInput } from "@/lib/validation";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapAssignor, toPrismaStatus } from "@/server/entities";

function nextAssignorCode(count: number) {
  return `CED-${String(count + 1).padStart(3, "0")}`;
}

function toDate(value?: string) {
  return value ? new Date(value) : undefined;
}

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Cedentes", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json(assignorsSeed);

  const assignors = await db.assignor.findMany({
    where: { deletedAt: null },
    include: { portalUsers: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } } },
    orderBy: { code: "asc" },
  });
  return NextResponse.json(assignors.map(mapAssignor));
}

export async function POST(request: Request) {
  const input = parseAssignorInput(await request.json().catch(() => null));
  if (input.error) return NextResponse.json({ error: input.error }, { status: 400 });
  if (!input.data) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  const data = input.data;
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Cedentes", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!db) {
    return NextResponse.json({
      id: nextAssignorCode(assignorsSeed.length),
      nome: data.nome,
      nomeFantasia: data.nomeFantasia ?? null,
      doc: data.doc,
      inscricaoEstadual: data.inscricaoEstadual ?? null,
      inscricaoMunicipal: data.inscricaoMunicipal ?? null,
      fundacao: data.fundacao ?? null,
      setor: data.extra,
      site: data.site ?? null,
      email: data.email ?? null,
      telefone: data.telefone ?? null,
      endereco: data.endereco ?? null,
      cidade: data.cidade ?? null,
      uf: data.uf ?? null,
      grupoEconomico: data.grupoEconomico ?? null,
      receitaAnual: data.receitaAnual ?? null,
      funcionarios: data.funcionarios ?? null,
      limite: data.valor,
      exposicao: 0,
      gerenteRelacionamento: data.gerenteRelacionamento ?? null,
      etapaOnboarding: data.etapaOnboarding ?? null,
      complianceStatus: data.complianceStatus ?? null,
      kycStatus: data.kycStatus ?? null,
      consultaSancoes: data.consultaSancoes ?? null,
      exposicaoPep: data.exposicaoPep ?? null,
      parecerCompliance: data.parecerCompliance ?? null,
      ultimaRevisaoCompliance: data.ultimaRevisaoCompliance ?? null,
      procuradores: data.procuradores ?? [],
      beneficiariosFinais: data.beneficiariosFinais ?? [],
      status: data.status,
    });
  }

  const count = await db.assignor.count();
  const created = await db.assignor.create({
    data: {
      code: nextAssignorCode(count),
      legalName: data.nome,
      tradeName: data.nomeFantasia,
      taxId: data.doc,
      stateRegistration: data.inscricaoEstadual,
      municipalRegistration: data.inscricaoMunicipal,
      foundationDate: toDate(data.fundacao),
      sector: data.extra,
      website: data.site,
      email: data.email,
      phone: data.telefone,
      addressLine: data.endereco,
      addressCity: data.cidade,
      addressState: data.uf,
      economicGroup: data.grupoEconomico,
      annualRevenue: data.receitaAnual,
      employeeCount: data.funcionarios,
      creditLimit: data.valor,
      relationshipManager: data.gerenteRelacionamento,
      onboardingStage: data.etapaOnboarding,
      complianceStatus: data.complianceStatus,
      kycStatus: data.kycStatus,
      sanctionScreening: data.consultaSancoes,
      pepExposure: data.exposicaoPep,
      complianceNotes: data.parecerCompliance,
      lastComplianceReview: toDate(data.ultimaRevisaoCompliance),
      representatives: data.procuradores as Prisma.InputJsonValue,
      ultimateBeneficialOwners: data.beneficiariosFinais as Prisma.InputJsonValue,
      status: toPrismaStatus(data.status),
    },
  });

  await writeAudit(db, {
    action: "ASSIGNOR_CREATED",
    entityType: "Assignor",
    entityId: created.code,
    userId: auth.user.id,
    after: created,
  });

  return NextResponse.json(mapAssignor(created), { status: 201 });
}
