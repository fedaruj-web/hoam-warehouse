import { NextResponse } from "next/server";
import { parseDebtorInput } from "@/lib/validation";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapDebtor, toPrismaStatus } from "@/server/entities";

type Context = { params: Promise<{ id: string }> };

function toDate(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const input = parseDebtorInput(await request.json().catch(() => null));
  if (input.error) return NextResponse.json({ error: input.error }, { status: 400 });
  if (!input.data) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  const data = input.data;
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Sacados", "update");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!db) {
    return NextResponse.json({
      id,
      nome: data.nome,
      nomeFantasia: data.nomeFantasia ?? null,
      doc: data.doc,
      rating: data.extra,
      valor: data.valor,
      email: data.email ?? null,
      telefone: data.telefone ?? null,
      site: data.site ?? null,
      endereco: data.endereco ?? null,
      cidade: data.cidade ?? null,
      uf: data.uf ?? null,
      contatoFinanceiroNome: data.contatoFinanceiroNome ?? null,
      contatoFinanceiroCargo: data.contatoFinanceiroCargo ?? null,
      contatoFinanceiroEmail: data.contatoFinanceiroEmail ?? null,
      contatoFinanceiroTelefone: data.contatoFinanceiroTelefone ?? null,
      emailConfirmacao: data.emailConfirmacao ?? null,
      telefoneConfirmacao: data.telefoneConfirmacao ?? null,
      canalConfirmacao: data.canalConfirmacao ?? "E-mail",
      janelaConfirmacao: data.janelaConfirmacao ?? null,
      statusConfirmacao: data.statusConfirmacao ?? "Pendente",
      ultimaConfirmacao: data.ultimaConfirmacao ?? null,
      observacaoConfirmacao: data.observacaoConfirmacao ?? null,
      evidenciaRelacionamento: data.evidenciaRelacionamento ?? null,
      historicoProtestos: data.historicoProtestos ?? null,
      comportamentoPagamento: data.comportamentoPagamento ?? null,
      observacoesOperacionais: data.observacoesOperacionais ?? null,
      status: data.status,
    });
  }

  const before = await db.debtor.findUnique({ where: { code: id } });
  if (!before || before.deletedAt) return NextResponse.json({ error: "Sacado não encontrado." }, { status: 404 });

  const updated = await db.debtor.update({
    where: { code: id },
    data: {
      legalName: data.nome,
      tradeName: data.nomeFantasia,
      taxId: data.doc,
      rating: data.extra,
      exposureLimit: data.valor,
      email: data.email,
      phone: data.telefone,
      website: data.site,
      addressLine: data.endereco,
      addressCity: data.cidade,
      addressState: data.uf,
      financialContactName: data.contatoFinanceiroNome,
      financialContactRole: data.contatoFinanceiroCargo,
      financialContactEmail: data.contatoFinanceiroEmail,
      financialContactPhone: data.contatoFinanceiroTelefone,
      confirmationEmail: data.emailConfirmacao,
      confirmationPhone: data.telefoneConfirmacao,
      confirmationChannel: data.canalConfirmacao,
      confirmationWindow: data.janelaConfirmacao,
      confirmationStatus: data.statusConfirmacao,
      lastConfirmationAt: toDate(data.ultimaConfirmacao),
      confirmationNotes: data.observacaoConfirmacao,
      relationshipEvidence: data.evidenciaRelacionamento,
      protestHistory: data.historicoProtestos,
      paymentBehavior: data.comportamentoPagamento,
      operationalNotes: data.observacoesOperacionais,
      status: toPrismaStatus(data.status),
    },
  });

  await writeAudit(db, {
    action: "DEBTOR_UPDATED",
    entityType: "Debtor",
    entityId: updated.code,
    userId: auth.user.id,
    before,
    after: updated,
  });

  return NextResponse.json(mapDebtor(updated));
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Sacados", "admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ ok: true, id, deletedAt: new Date().toISOString() });

  const before = await db.debtor.findUnique({ where: { code: id } });
  if (!before || before.deletedAt) return NextResponse.json({ error: "Sacado não encontrado." }, { status: 404 });

  const updated = await db.debtor.update({
    where: { code: id },
    data: { deletedAt: new Date(), status: "INACTIVE" },
  });

  await writeAudit(db, {
    action: "DEBTOR_SOFT_DELETED",
    entityType: "Debtor",
    entityId: updated.code,
    userId: auth.user.id,
    before,
    after: updated,
  });

  return NextResponse.json(mapDebtor(updated));
}
