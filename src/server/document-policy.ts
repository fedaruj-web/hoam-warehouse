import type { PrismaClient } from "@prisma/client";

type ReceivableForDocs = {
  id: string;
  status: string;
  confirmationStatus?: string | null;
};

export type DocumentGap = {
  requirement: string;
  label: string;
  type: string;
};

const baseRequirements: DocumentGap[] = [
  { requirement: "BORDERO_IMPORTACAO", label: "Borderô de importação", type: "BORDER" },
  { requirement: "COMPROVANTE_LASTRO", label: "Comprovante de lastro", type: "COLLATERAL" },
];

export function requiredDocumentsForPurchase(receivable: ReceivableForDocs): DocumentGap[] {
  const requirements = [...baseRequirements];
  if (receivable.confirmationStatus === "Confirmado") {
    requirements.push({ requirement: "EVIDENCIA_CONFIRMACAO", label: "Evidência de confirmação do sacado", type: "RECEIPT" });
  }
  if (receivable.status === "APPROVED") {
    requirements.push({ requirement: "ATA_COMITE", label: "Ata/justificativa de aprovação do comitê", type: "COMMITTEE" });
  }
  return requirements;
}

export async function getPurchaseDocumentGaps(db: PrismaClient, receivable: ReceivableForDocs) {
  const requirements = requiredDocumentsForPurchase(receivable);
  const docs = await db.document.findMany({
    where: {
      receivableId: receivable.id,
      deletedAt: null,
      status: "VALID",
      OR: requirements.map((item) => ({ type: item.type as never })),
    },
    select: { type: true, requirement: true, expiresAt: true },
  });

  const today = new Date();
  return requirements.filter((required) => {
    return !docs.some((doc) => {
      const matchesType = doc.type === required.type;
      const matchesRequirement = !doc.requirement || doc.requirement === required.requirement;
      const notExpired = !doc.expiresAt || doc.expiresAt >= today;
      return matchesType && matchesRequirement && notExpired;
    });
  });
}
