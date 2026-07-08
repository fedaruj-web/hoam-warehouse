import type {
  AccessGroup,
  AppUser,
  Assignor,
  Audit,
  BankStatementEntry,
  CashAccount,
  CashMovement,
  Debtor,
  DocumentRecord,
  FundingIssue,
  ImportBatch,
  PermissionAction,
  PermissionMap,
  Receivable,
} from "./types";

export const modules = [
  "Dashboard",
  "Alertas",
  "Esteira",
  "Cedentes",
  "Sacados",
  "Importação",
  "Confirmação",
  "Elegibilidade",
  "Risco",
  "Comitê",
  "Compra",
  "Carteira",
  "Caixa",
  "Cobrança",
  "Funding",
  "Documentos",
  "Relatórios",
  "Usuários",
  "Audit log",
];

export const actions: { key: PermissionAction; label: string }[] = [
  { key: "view", label: "Ver" },
  { key: "create", label: "Criar/Editar" },
  { key: "approve", label: "Aprovar" },
  { key: "purchase", label: "Comprar" },
  { key: "admin", label: "Admin" },
];

export const allPermissions = Object.fromEntries(
  modules.map((module) => [module, actions.map((action) => action.key)]),
) as PermissionMap;

export const viewOnly = Object.fromEntries(
  modules.map((module) => [module, ["view"] as PermissionAction[]]),
) as PermissionMap;

export const assignorsSeed: Assignor[] = [
  {
    id: "CED-001",
    nome: "Alvorada Alimentos S.A.",
    doc: "12.345.678/0001-90",
    setor: "Alimentos",
    limite: 12_500_000,
    exposicao: 3_840_000,
    status: "Ativo",
  },
  {
    id: "CED-002",
    nome: "Nexum Tecnologia Ltda.",
    doc: "28.456.789/0001-12",
    setor: "Tecnologia",
    limite: 6_800_000,
    exposicao: 1_180_000,
    status: "Ativo",
  },
  {
    id: "CED-003",
    nome: "Grupo Monte Azul",
    doc: "07.654.321/0001-45",
    setor: "Logística",
    limite: 9_200_000,
    exposicao: 0,
    status: "Em análise",
  },
  {
    id: "CED-004",
    nome: "Vértice Indústria S.A.",
    doc: "51.100.700/0001-22",
    setor: "Indústria",
    limite: 15_000_000,
    exposicao: 728_000,
    status: "Ativo",
  },
];

export const debtorsSeed: Debtor[] = [
  {
    id: "SAC-182",
    nome: "Rede Nacional de Varejo S.A.",
    doc: "44.123.876/0001-02",
    rating: "AA",
    valor: 3_840_000,
    status: "Ativo",
  },
  {
    id: "SAC-144",
    nome: "Distribuidora Horizonte Ltda.",
    doc: "19.882.210/0001-65",
    rating: "A",
    valor: 2_260_000,
    status: "Ativo",
  },
  {
    id: "SAC-097",
    nome: "Mercantil Paulista S.A.",
    doc: "03.448.760/0001-19",
    rating: "BBB",
    valor: 1_180_000,
    status: "Monitorar",
  },
  {
    id: "SAC-211",
    nome: "Comercial Aurora Ltda.",
    doc: "08.271.332/0001-75",
    rating: "A",
    valor: 728_000,
    status: "Ativo",
  },
];

export const receivablesSeed: Receivable[] = [
  {
    id: "DPL-89421",
    ced: "Alvorada Alimentos S.A.",
    sac: "Rede Nacional de Varejo S.A.",
    emissao: "01/07/2026",
    venc: "18/08/2026",
    valor: 486_000,
    preco: 474_336,
    status: "Comprado",
  },
  {
    id: "DPL-89422",
    ced: "Alvorada Alimentos S.A.",
    sac: "Distribuidora Horizonte Ltda.",
    emissao: "03/07/2026",
    venc: "22/08/2026",
    valor: 312_500,
    status: "Elegível",
  },
  {
    id: "DPL-77401",
    ced: "Nexum Tecnologia Ltda.",
    sac: "Mercantil Paulista S.A.",
    emissao: "05/07/2026",
    venc: "04/09/2026",
    valor: 194_000,
    status: "Revisão",
  },
  {
    id: "DPL-66218",
    ced: "Vértice Indústria S.A.",
    sac: "Comercial Aurora Ltda.",
    emissao: "04/07/2026",
    venc: "11/09/2026",
    valor: 728_000,
    status: "Elegível",
  },
];

export const batchesSeed: ImportBatch[] = [
  {
    id: "LOT-001",
    fileName: "bordero_alvorada_jul26.csv",
    status: "Processado",
    totalRows: 4,
    validRows: 3,
    invalidRows: 1,
    createdAt: "Hoje, 09:12",
  },
];

export const groupsSeed: AccessGroup[] = [
  {
    id: "admin",
    name: "Administrador",
    description: "Acesso completo à plataforma, usuários, permissões e audit log.",
    users: 1,
    permissions: allPermissions,
  },
  {
    id: "credito",
    name: "Crédito",
    description: "Análise de cedentes, sacados e motor de elegibilidade.",
    users: 2,
    permissions: {
      ...viewOnly,
      Cedentes: ["view", "create", "approve"],
      Sacados: ["view", "create", "approve"],
      Elegibilidade: ["view", "approve"],
      Risco: ["view"],
      "Comitê": ["view"],
      "Relatórios": ["view"],
    },
  },
  {
    id: "operacoes",
    name: "Operações",
    description: "Importação, compra de ativos e gestão operacional da carteira.",
    users: 2,
    permissions: {
      ...viewOnly,
      "Importação": ["view", "create"],
      "Confirmação": ["view", "create"],
      Compra: ["view", "purchase"],
      Carteira: ["view", "create"],
      Caixa: ["view", "create"],
      "Cobrança": ["view", "create"],
      Funding: ["view", "create"],
      Documentos: ["view", "create"],
    },
  },
  {
    id: "comite",
    name: "Comitê",
    description: "Visão executiva e aprovação de exceções.",
    users: 1,
    permissions: {
      ...viewOnly,
      Elegibilidade: ["view", "approve"],
      "Comitê": ["view", "approve"],
      Compra: ["view", "approve"],
      "Audit log": ["view"],
    },
  },
  {
    id: "consulta",
    name: "Consulta",
    description: "Acesso somente leitura para acompanhamento e relatórios.",
    users: 3,
    permissions: viewOnly,
  },
];

export const usersSeed: AppUser[] = [
  {
    id: "USR-001",
    name: "Felipe Martins",
    email: "felipe@hoam.com.br",
    groupId: "admin",
    status: "Ativo",
    lastAccess: "Hoje, 09:41",
  },
  {
    id: "USR-002",
    name: "Marina Andrade",
    email: "marina@hoam.com.br",
    groupId: "credito",
    status: "Ativo",
    lastAccess: "Ontem, 18:07",
  },
  {
    id: "USR-003",
    name: "Rafael Nogueira",
    email: "rafael@hoam.com.br",
    groupId: "operacoes",
    status: "Ativo",
    lastAccess: "05/07, 14:22",
  },
  {
    id: "USR-004",
    name: "Comitê HOAM",
    email: "comite@hoam.com.br",
    groupId: "comite",
    status: "Convite pendente",
    lastAccess: "Nunca",
  },
];

export const auditsSeed: Audit[] = [
  {
    id: "AUD-1042",
    action: "LOGIN_SUCCESS",
    entity: "Sessão",
    user: "Felipe Martins",
    at: "Hoje, 09:41",
  },
  {
    id: "AUD-1041",
    action: "PURCHASE_CREATED",
    entity: "DPL-89421",
    user: "Rafael Nogueira",
    at: "Ontem, 17:03",
  },
];

export const documentsSeed: DocumentRecord[] = [
  {
    id: "DOC-001",
    name: "Contrato-mãe Alvorada.pdf",
    type: "Contrato",
    entity: "Alvorada Alimentos S.A.",
    status: "Válido",
    uploadedAt: "Hoje, 08:55",
    size: "2,4 MB",
  },
  {
    id: "DOC-002",
    name: "Borderô lote LOT-001.xlsx",
    type: "Borderô",
    entity: "LOT-001",
    status: "Válido",
    uploadedAt: "Hoje, 09:12",
    size: "412 KB",
  },
  {
    id: "DOC-003",
    name: "KYC Grupo Monte Azul.pdf",
    type: "KYC",
    entity: "Grupo Monte Azul",
    status: "Em revisão",
    uploadedAt: "Ontem, 16:30",
    size: "5,1 MB",
  },
];

export const cashSeed: CashMovement[] = [
  { id: "CX-001", accountId: "CTA-WH-RECEB", accountName: "Warehouse · Recebimentos de sacados", date: "07/07/2026", description: "Aporte warehouse", type: "Entrada", amount: 12_400_000 },
  { id: "CX-002", accountId: "CTA-WH-COMPRA", accountName: "Warehouse · Liquidação de compras", date: "07/07/2026", description: "Compra DPL-89421", type: "Saída", amount: 474_336 },
  { id: "CX-003", accountId: "CTA-WH-RECEB", accountName: "Warehouse · Recebimentos de sacados", date: "06/07/2026", description: "Liquidação sacado", type: "Entrada", amount: 820_000 },
];

export const cashAccountsSeed: CashAccount[] = [
  { id: "CTA-WH-COMPRA", name: "Warehouse · Liquidação de compras", bankName: "Banco parceiro", branch: "0001", accountNumber: "10001-0", accountType: "Conta movimento", purpose: "PURCHASE_SETTLEMENT", currency: "BRL", openingBalance: 0, balance: -474_336, status: "Ativa" },
  { id: "CTA-WH-RECEB", name: "Warehouse · Recebimentos de sacados", bankName: "Banco parceiro", branch: "0001", accountNumber: "10002-9", accountType: "Conta recebimento", purpose: "RECEIVABLE_COLLECTION", currency: "BRL", openingBalance: 0, balance: 13_220_000, status: "Ativa" },
  { id: "CTA-WH-RESERVA", name: "Warehouse · Reserva operacional", bankName: "Banco parceiro", branch: "0001", accountNumber: "10003-7", accountType: "Conta reserva", purpose: "RESERVE", currency: "BRL", openingBalance: 0, balance: 0, status: "Ativa" },
];

export const bankStatementSeed: BankStatementEntry[] = [
  { id: "EXT-0001", accountId: "CTA-WH-RECEB", accountName: "Warehouse · Recebimentos de sacados", date: "07/07/2026", description: "Crédito TED sacado", type: "Entrada", amount: 820_000, reference: "TED-820", status: "Pendente" },
  { id: "EXT-0002", accountId: "CTA-WH-COMPRA", accountName: "Warehouse · Liquidação de compras", date: "07/07/2026", description: "Pagamento compra DPL-89421", type: "Saída", amount: 474_336, reference: "DPL-89421", status: "Pendente" },
];

export const fundingSeed: FundingIssue[] = [
  {
    id: "EMI-001",
    instrument: "FIDC Sênior Série A",
    amount: 40_000_000,
    rate: "CDI + 2,20%",
    maturity: "2029",
    status: "Estruturando",
  },
  {
    id: "EMI-002",
    instrument: "Nota Comercial",
    amount: 18_000_000,
    rate: "CDI + 3,10%",
    maturity: "2027",
    status: "Emitido",
  },
];


