import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { parseAssignorInput } from "@/lib/validation";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapAssignor, toPrismaStatus } from "@/server/entities";

type Context = { params: Promise<{ id: string }> };

function toDate(value?: string) {
  return value ? new Date(value) : undefined;
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const input = parseAssignorInput(await request.json().catch(() => null));
  if (input.error) return NextResponse.json({ error: input.error }, { status: 400 });
  if (!input.data) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  const data = input.data;
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Cedentes", "update");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!db) {
    return NextResponse.json({
      id,
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

  const before = await db.assignor.findUnique({ where: { code: id } });
  if (!before || before.deletedAt) return NextResponse.json({ error: "Cedente não encontrado." }, { status: 404 });

  await db.assignor.update({
    where: { code: id },
    data: {
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
  const updated = await db.assignor.findUniqueOrThrow({
    where: { code: id },
    include: { portalUsers: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } } },
  });

  await writeAudit(db, {
    action: "ASSIGNOR_UPDATED",
    entityType: "Assignor",
    entityId: updated.code,
    userId: auth.user.id,
    before,
    after: updated,
  });

  return NextResponse.json(mapAssignor(updated));
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Cedentes", "admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ ok: true, id, deletedAt: new Date().toISOString() });

  const before = await db.assignor.findUnique({ where: { code: id } });
  if (!before || before.deletedAt) return NextResponse.json({ error: "Cedente não encontrado." }, { status: 404 });

  const updated = await db.assignor.update({
    where: { code: id },
    data: { deletedAt: new Date(), status: "INACTIVE" },
  });

  await writeAudit(db, {
    action: "ASSIGNOR_SOFT_DELETED",
    entityType: "Assignor",
    entityId: updated.code,
    userId: auth.user.id,
    before,
    after: updated,
  });

  return NextResponse.json(mapAssignor(updated));
}
