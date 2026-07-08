import { NextResponse } from "next/server";
import { debtorsSeed } from "@/lib/mock-data";
import { parseDebtorInput } from "@/lib/validation";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapDebtor, toPrismaStatus } from "@/server/entities";

function nextDebtorCode(count: number) {
  return `SAC-${String(count + 200).padStart(3, "0")}`;
}

function toDate(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function GET() {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Sacados", "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json(debtorsSeed);

  const debtors = await db.debtor.findMany({
    where: { deletedAt: null },
    orderBy: { code: "asc" },
  });
  return NextResponse.json(debtors.map(mapDebtor));
}

export async function POST(request: Request) {
  const input = parseDebtorInput(await request.json().catch(() => null));
  if (input.error) return NextResponse.json({ error: input.error }, { status: 400 });
  if (!input.data) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  const data = input.data;
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Sacados", "create");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!db) {
    return NextResponse.json({
      id: nextDebtorCode(debtorsSeed.length),
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

  const count = await db.debtor.count();
  const created = await db.debtor.create({
    data: {
      code: nextDebtorCode(count),
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
    action: "DEBTOR_CREATED",
    entityType: "Debtor",
    entityId: created.code,
    userId: auth.user.id,
    after: created,
  });

  return NextResponse.json(mapDebtor(created), { status: 201 });
}
