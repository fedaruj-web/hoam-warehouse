import type { Debtor, Receivable } from "./types";

export type XmlDebtorDraft = {
  legalName: string;
  tradeName?: string | null;
  taxId: string;
  email?: string | null;
  phone?: string | null;
  addressLine?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  confirmationEmail?: string | null;
  confirmationPhone?: string | null;
};

export type XmlReceivableDraft = Receivable & {
  assignorTaxId?: string | null;
  assignorName?: string | null;
  debtorTaxId: string;
};

export type XmlImportResult = {
  receivables: XmlReceivableDraft[];
  debtors: XmlDebtorDraft[];
  errors: string[];
};

function decodeXml(value?: string | null) {
  return (value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .trim();
}

function compactDigits(value?: string | null) {
  return decodeXml(value).replace(/\D/g, "");
}

function tagPattern(tag: string) {
  return new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`, "i");
}

function allTagPattern(tag: string) {
  return new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`, "gi");
}

function readTag(xml: string, tag: string) {
  return decodeXml(xml.match(tagPattern(tag))?.[1]);
}

function readBlock(xml: string, tag: string) {
  return xml.match(tagPattern(tag))?.[1] ?? "";
}

function readBlocks(xml: string, tag: string) {
  return [...xml.matchAll(allTagPattern(tag))].map((match) => match[1]);
}

function readInfNfeBlocks(content: string) {
  const blocks = [...content.matchAll(/<[^>]*infNFe\b[^>]*>[\s\S]*?<\/[^>]*infNFe>/gi)].map((match) => match[0]);
  return blocks.length ? blocks : [content];
}

function readInfNfeId(xml: string) {
  return decodeXml(xml.match(/<[^>]*infNFe\b[^>]*\bId=["'](?:NFe)?([^"']+)["']/i)?.[1]);
}

function formatImportDate(value: string) {
  const text = decodeXml(value);
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function toNumber(value: string) {
  const text = decodeXml(value);
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : NaN;
}

function buildAddress(addressBlock: string) {
  const street = readTag(addressBlock, "xLgr");
  const number = readTag(addressBlock, "nro");
  const complement = readTag(addressBlock, "xCpl");
  const district = readTag(addressBlock, "xBairro");
  const zipCode = readTag(addressBlock, "CEP");
  const country = readTag(addressBlock, "xPais");
  const base = [street, number, complement, district].filter(Boolean).join(", ");
  const extra = [zipCode ? `CEP ${zipCode}` : "", country].filter(Boolean).join(" · ");
  return [base, extra].filter(Boolean).join(" · ") || null;
}

function toDebtorUi(draft: XmlDebtorDraft): Debtor {
  return {
    id: `SAC-XML-${draft.taxId.slice(-6)}`,
    nome: draft.legalName,
    nomeFantasia: draft.tradeName ?? null,
    doc: draft.taxId,
    rating: "Sem rating",
    valor: 0,
    email: draft.email ?? null,
    telefone: draft.phone ?? null,
    endereco: draft.addressLine ?? null,
    cidade: draft.addressCity ?? null,
    uf: draft.addressState ?? null,
    contatoFinanceiroEmail: draft.confirmationEmail ?? draft.email ?? null,
    contatoFinanceiroTelefone: draft.confirmationPhone ?? draft.phone ?? null,
    emailConfirmacao: draft.confirmationEmail ?? draft.email ?? null,
    telefoneConfirmacao: draft.confirmationPhone ?? draft.phone ?? null,
    canalConfirmacao: "E-mail",
    statusConfirmacao: "Pendente",
    observacoesOperacionais: "Sacado extraído automaticamente de XML NF-e.",
    status: "Ativo",
  };
}

export function parseXmlNfeReceivables(content: string, batchId: string): XmlImportResult {
  const normalized = content.trim();
  if (!normalized) return { receivables: [], debtors: [], errors: ["Arquivo XML vazio."] };
  if (!/<(?:[\w.-]+:)?NFe\b|<(?:[\w.-]+:)?infNFe\b/i.test(normalized)) {
    return { receivables: [], debtors: [], errors: ["XML não parece conter uma NF-e válida."] };
  }

  const errors: string[] = [];
  const receivables: XmlReceivableDraft[] = [];
  const debtorsByTaxId = new Map<string, XmlDebtorDraft>();

  readInfNfeBlocks(normalized).forEach((infNfe, invoiceIndex) => {
    const ide = readBlock(infNfe, "ide");
    const emit = readBlock(infNfe, "emit");
    const dest = readBlock(infNfe, "dest");
    const cobr = readBlock(infNfe, "cobr");
    const destAddress = readBlock(dest, "enderDest");
    const infNfeId = readInfNfeId(infNfe);
    const invoiceNumber = readTag(ide, "nNF");
    const issuedAt = formatImportDate(readTag(ide, "dhEmi") || readTag(ide, "dEmi"));
    const assignorTaxId = compactDigits(readTag(emit, "CNPJ") || readTag(emit, "CPF"));
    const assignorName = readTag(emit, "xNome");
    const debtorTaxId = compactDigits(readTag(dest, "CNPJ") || readTag(dest, "CPF") || readTag(dest, "idEstrangeiro"));
    const debtorName = readTag(dest, "xNome");

    if (!assignorTaxId) errors.push(`NF-e ${invoiceNumber || invoiceIndex + 1}: CNPJ/CPF do emitente não encontrado.`);
    if (!debtorTaxId) errors.push(`NF-e ${invoiceNumber || invoiceIndex + 1}: CNPJ/CPF do sacado/destinatário não encontrado.`);
    if (!debtorName) errors.push(`NF-e ${invoiceNumber || invoiceIndex + 1}: nome do sacado/destinatário não encontrado.`);

    if (debtorTaxId && debtorName) {
      debtorsByTaxId.set(debtorTaxId, {
        legalName: debtorName,
        tradeName: readTag(dest, "xFant") || null,
        taxId: debtorTaxId,
        email: readTag(dest, "email") || null,
        phone: readTag(destAddress, "fone") || null,
        addressLine: buildAddress(destAddress),
        addressCity: readTag(destAddress, "xMun") || null,
        addressState: readTag(destAddress, "UF") || null,
        confirmationEmail: readTag(dest, "email") || null,
        confirmationPhone: readTag(destAddress, "fone") || null,
      });
    }

    const duplicates = readBlocks(cobr, "dup");
    if (!duplicates.length) {
      errors.push(`NF-e ${invoiceNumber || invoiceIndex + 1}: nenhuma duplicata encontrada em <cobr><dup>.`);
      return;
    }

    duplicates.forEach((dup, dupIndex) => {
      const duplicateNumber = readTag(dup, "nDup") || String(dupIndex + 1).padStart(3, "0");
      const dueDate = formatImportDate(readTag(dup, "dVenc"));
      const amount = toNumber(readTag(dup, "vDup"));
      if (!dueDate || Number.isNaN(amount) || amount <= 0 || !assignorTaxId || !debtorTaxId || !debtorName) {
        errors.push(`NF-e ${invoiceNumber || invoiceIndex + 1}, duplicata ${duplicateNumber}: vencimento, valor, cedente ou sacado inválido.`);
        return;
      }

      const externalBase = infNfeId || invoiceNumber || `XML-${invoiceIndex + 1}`;
      receivables.push({
        id: `NFE-${externalBase}-${duplicateNumber}`,
        ced: assignorName || assignorTaxId,
        sac: debtorName,
        debtorRating: "Sem rating",
        emissao: issuedAt || new Date().toLocaleDateString("pt-BR"),
        venc: dueDate,
        valor: amount,
        status: "Importado",
        confirmationStatus: "Pendente",
        confirmationChannel: "E-mail",
        batchId,
        assignorTaxId,
        assignorName,
        debtorTaxId,
      });
    });
  });

  return {
    receivables,
    debtors: [...debtorsByTaxId.values()],
    errors,
  };
}

export function parseXmlNfeReceivablesForUi(content: string, batchId: string) {
  const parsed = parseXmlNfeReceivables(content, batchId);
  return {
    receivables: parsed.receivables,
    debtors: parsed.debtors.map(toDebtorUi),
    errors: parsed.errors,
  };
}
