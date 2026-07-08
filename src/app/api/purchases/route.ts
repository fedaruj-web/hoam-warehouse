import { NextResponse } from "next/server";
import type { ReceivableStatus as PrismaReceivableStatus } from "@prisma/client";
import { priceReceivable } from "@/lib/domain";
import { requirePermission } from "@/server/authz";
import { getDbOrNull } from "@/server/db";
import { mapReceivable } from "@/server/entities";
import { writeAudit } from "@/server/audit";
import { getPurchaseDocumentGaps } from "@/server/document-policy";
import { getOperationalCashAccount } from "@/server/cash";

function nextPurchaseCode(count: number) {
  return `CPR-${String(count + 1).padStart(4, "0")}`;
}

export async function POST(request: Request) {
  const db = getDbOrNull();
  const auth = await requirePermission(db, "Compra", "purchase");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const receivableId = String(body?.receivableId ?? "");
  const receivableIds = Array.isArray(body?.receivableIds) ? body.receivableIds.map((id: unknown) => String(id)).filter(Boolean) : [];
  const annualRate = Number(body?.annualRate ?? 0.285);
  const serviceFeeBps = Number(body?.serviceFeeBps ?? 0);

  if (!Number.isFinite(annualRate) || annualRate < 0) return NextResponse.json({ error: "Taxa inválida." }, { status: 400 });
  if (!Number.isFinite(serviceFeeBps) || serviceFeeBps < 0) return NextResponse.json({ error: "Custos inválidos." }, { status: 400 });

  if (receivableIds.length) {
    const ticketCode = String(body?.ticketId ?? body?.ticketCode ?? "").trim();
    if (ticketCode) {
      const ticket = await db.purchaseTicket.findUnique({ where: { code: ticketCode } });
      if (!ticket || ticket.deletedAt) return NextResponse.json({ error: "Boleta não encontrada." }, { status: 404 });
      if (ticket.status !== "Aprovada") return NextResponse.json({ error: "Boleta precisa estar aprovada para compra da cesta." }, { status: 409 });
    }

    const receivables = await db.receivable.findMany({
      where: { externalId: { in: receivableIds }, deletedAt: null },
      include: { assignor: true, debtor: true, batch: true, portfolio: true },
    });
    if (receivables.length !== receivableIds.length) return NextResponse.json({ error: "Um ou mais ativos não foram encontrados." }, { status: 404 });
    const purchased = receivables.filter((item) => item.status === "PURCHASED");
    if (purchased.length) return NextResponse.json({ error: `Ativos já comprados: ${purchased.map((item) => item.externalId).join(", ")}.` }, { status: 409 });
    const assignorIds = new Set(receivables.map((item) => item.assignorId));
    if (assignorIds.size > 1) return NextResponse.json({ error: "Compra agrupada exige ativos do mesmo cedente nesta versão." }, { status: 409 });

    const priced: { receivable: (typeof receivables)[number]; pricing: ReturnType<typeof priceReceivable> }[] = [];
    for (const receivable of receivables) {
      if (!["ELIGIBLE", "APPROVED"].includes(receivable.status)) {
        return NextResponse.json({ error: `${receivable.externalId}: ativo precisa estar elegível ou aprovado.` }, { status: 409 });
      }
      if (receivable.assignor.deletedAt || receivable.assignor.status !== "ACTIVE") {
        return NextResponse.json({ error: `${receivable.externalId}: cedente precisa estar ativo.` }, { status: 409 });
      }
      if (receivable.debtor.deletedAt || receivable.debtor.status !== "ACTIVE") {
        return NextResponse.json({ error: `${receivable.externalId}: sacado precisa estar ativo.` }, { status: 409 });
      }
      const hasConfirmationBasis = ["Confirmado", "Dispensado"].includes(receivable.confirmationStatus) || Boolean(receivable.confirmationNotes?.trim());
      if (!hasConfirmationBasis) {
        return NextResponse.json({ error: `${receivable.externalId}: confirmação, dispensa ou justificativa manual é obrigatória.` }, { status: 409 });
      }
      const documentGaps = await getPurchaseDocumentGaps(db, receivable);
      if (documentGaps.length) {
        return NextResponse.json({ error: `${receivable.externalId}: pendências documentais impedem a compra.`, documentGaps }, { status: 409 });
      }
      const uiReceivable = mapReceivable(receivable);
      const pricing = priceReceivable(uiReceivable, annualRate, serviceFeeBps, receivable.debtor);
      if (pricing.purchasePrice <= 0 || pricing.purchasePrice < pricing.minimumPurchasePrice) {
        return NextResponse.json({ error: `${receivable.externalId}: preço líquido fora da política mínima.`, pricing }, { status: 409 });
      }
      if (pricing.discountPercent > 0.35 && receivable.status !== "APPROVED") {
        return NextResponse.json({ error: `${receivable.externalId}: deságio acima de 35% requer comitê.`, pricing }, { status: 409 });
      }
      priced.push({ receivable, pricing });
    }

    const purchaseCode = nextPurchaseCode(await db.purchase.count());
    const faceValue = priced.reduce((sum, row) => sum + row.pricing.faceValue, 0);
    const purchaseValue = priced.reduce((sum, row) => sum + row.pricing.purchasePrice, 0);

    const result = await db.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          code: purchaseCode,
          assignorId: priced[0].receivable.assignorId,
          status: "Pago",
          faceValue,
          purchaseValue,
          createdById: auth.user.id,
        },
      });

      const cashAccount = await getOperationalCashAccount(tx, "PURCHASE_SETTLEMENT", body?.cashAccountId ? String(body.cashAccountId) : null);
      await tx.cashMovement.create({
        data: {
          code: `CX-${String((await tx.cashMovement.count()) + 1).padStart(4, "0")}`,
          accountId: cashAccount.id,
          date: new Date(),
          description: `Compra agrupada ${purchase.code} · ${priced.length} ativo(s)`,
          type: "OUTFLOW",
          amount: purchaseValue,
          reference: ticketCode || purchase.code,
        },
      });

      for (const row of priced) {
        await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            receivableId: row.receivable.id,
            purchasePrice: row.pricing.purchasePrice,
            baseAnnualRate: row.pricing.baseAnnualRate,
            effectiveRate: row.pricing.annualRate,
            riskSpread: row.pricing.riskSpread,
            serviceFee: row.pricing.serviceFee,
            discount: row.pricing.discount,
            discountPercent: row.pricing.discountPercent,
            businessDays: row.pricing.businessDays,
            pricingSnapshot: row.pricing,
          },
        });
        await tx.receivable.update({ where: { id: row.receivable.id }, data: { status: "PURCHASED", purchasePrice: row.pricing.purchasePrice } });
        await tx.portfolioItem.upsert({
          where: { receivableId: row.receivable.id },
          create: { receivableId: row.receivable.id, acquisitionDate: new Date(), acquisitionValue: row.pricing.purchasePrice, outstandingValue: row.pricing.faceValue, status: "Ativo" },
          update: { acquisitionValue: row.pricing.purchasePrice, outstandingValue: row.pricing.faceValue, status: "Ativo", deletedAt: null },
        });
        await tx.workflowTransition.create({
          data: {
            receivableId: row.receivable.id,
            fromStatus: row.receivable.status as PrismaReceivableStatus,
            toStatus: "PURCHASED",
            reason: `Compra agrupada ${purchase.code} · preço ${row.pricing.purchasePrice.toFixed(2)}`,
            createdById: auth.user.id,
          },
        });
      }

      if (ticketCode) await tx.purchaseTicket.update({ where: { code: ticketCode }, data: { status: "Comprada" } });

      return tx.receivable.findMany({
        where: { id: { in: priced.map((row) => row.receivable.id) } },
        include: { assignor: true, debtor: true, batch: true, portfolio: true },
      });
    });

    await writeAudit(db, {
      action: "BASKET_PURCHASED",
      entityType: "Purchase",
      entityId: purchaseCode,
      userId: auth.user.id,
      before: receivables,
      after: { purchaseCode, ticketCode, faceValue, purchaseValue, receivables: result },
    });

    return NextResponse.json({ purchaseCode, receivables: result.map(mapReceivable) }, { status: 201 });
  }

  if (!receivableId) return NextResponse.json({ error: "Ativo não informado." }, { status: 400 });

  const receivable = await db.receivable.findUnique({
    where: { externalId: receivableId },
    include: { assignor: true, debtor: true, batch: true, portfolio: true },
  });

  if (!receivable || receivable.deletedAt) {
    return NextResponse.json({ error: "Ativo não encontrado." }, { status: 404 });
  }

  if (receivable.status === "PURCHASED" && receivable.portfolio) {
    return NextResponse.json(mapReceivable(receivable));
  }

  if (!["ELIGIBLE", "APPROVED"].includes(receivable.status)) {
    return NextResponse.json({ error: "Ativo precisa estar elegível ou aprovado para compra." }, { status: 409 });
  }

  if (receivable.assignor.deletedAt || receivable.assignor.status !== "ACTIVE") {
    return NextResponse.json({ error: "Cedente precisa estar ativo para compra." }, { status: 409 });
  }

  if (receivable.debtor.deletedAt || receivable.debtor.status !== "ACTIVE") {
    return NextResponse.json({ error: "Sacado precisa estar ativo para compra." }, { status: 409 });
  }

  const hasConfirmationBasis = ["Confirmado", "Dispensado"].includes(receivable.confirmationStatus) || Boolean(receivable.confirmationNotes?.trim());
  if (!hasConfirmationBasis) {
    return NextResponse.json({ error: "Compra exige confirmação, dispensa ou justificativa manual registrada." }, { status: 409 });
  }

  const documentGaps = await getPurchaseDocumentGaps(db, receivable);
  if (documentGaps.length) {
    return NextResponse.json({
      error: "Pendências documentais obrigatórias impedem a compra.",
      documentGaps,
    }, { status: 409 });
  }

  const uiReceivable = mapReceivable(receivable);
  const pricing = priceReceivable(uiReceivable, annualRate, serviceFeeBps, receivable.debtor);
  if (pricing.purchasePrice <= 0 || pricing.purchasePrice < pricing.minimumPurchasePrice) {
    return NextResponse.json({ error: "Preço líquido fora da política mínima de aquisição.", pricing }, { status: 409 });
  }
  if (pricing.discountPercent > 0.35 && receivable.status !== "APPROVED") {
    return NextResponse.json({ error: "Deságio acima de 35% requer aprovação de comitê.", pricing }, { status: 409 });
  }
  const purchaseCode = nextPurchaseCode(await db.purchase.count());

  const result = await db.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        code: purchaseCode,
        assignorId: receivable.assignorId,
        status: "Pago",
        faceValue: pricing.faceValue,
        purchaseValue: pricing.purchasePrice,
        createdById: auth.user.id,
      },
    });

    await tx.purchaseItem.create({
      data: {
        purchaseId: purchase.id,
        receivableId: receivable.id,
        purchasePrice: pricing.purchasePrice,
        baseAnnualRate: pricing.baseAnnualRate,
        effectiveRate: pricing.annualRate,
        riskSpread: pricing.riskSpread,
        serviceFee: pricing.serviceFee,
        discount: pricing.discount,
        discountPercent: pricing.discountPercent,
        businessDays: pricing.businessDays,
        pricingSnapshot: pricing,
      },
    });

    await tx.receivable.update({
      where: { id: receivable.id },
      data: {
        status: "PURCHASED",
        purchasePrice: pricing.purchasePrice,
      },
    });

    await tx.portfolioItem.upsert({
      where: { receivableId: receivable.id },
      create: {
        receivableId: receivable.id,
        acquisitionDate: new Date(),
        acquisitionValue: pricing.purchasePrice,
        outstandingValue: pricing.faceValue,
        status: "Ativo",
      },
      update: {
        acquisitionValue: pricing.purchasePrice,
        outstandingValue: pricing.faceValue,
        status: "Ativo",
        deletedAt: null,
      },
    });

    const cashAccount = await getOperationalCashAccount(tx, "PURCHASE_SETTLEMENT", body?.cashAccountId ? String(body.cashAccountId) : null);
    await tx.cashMovement.create({
      data: {
        code: `CX-${String((await tx.cashMovement.count()) + 1).padStart(4, "0")}`,
        accountId: cashAccount.id,
        date: new Date(),
        description: `Compra ${receivable.externalId} · ${purchase.code}`,
        type: "OUTFLOW",
        amount: pricing.purchasePrice,
        reference: receivable.externalId,
      },
    });

    await tx.workflowTransition.create({
      data: {
        receivableId: receivable.id,
        fromStatus: receivable.status as PrismaReceivableStatus,
        toStatus: "PURCHASED",
        reason: `Compra ${purchase.code} · preço ${pricing.purchasePrice.toFixed(2)}`,
        createdById: auth.user.id,
      },
    });

    return tx.receivable.findUniqueOrThrow({
      where: { id: receivable.id },
      include: { assignor: true, debtor: true, batch: true, portfolio: true },
    });
  });

  await writeAudit(db, {
    action: "ASSET_PURCHASED",
    entityType: "Receivable",
    entityId: result.externalId,
    userId: auth.user.id,
    before: receivable,
    after: { receivable: result, pricing },
  });

  return NextResponse.json(mapReceivable(result), { status: 201 });
}

