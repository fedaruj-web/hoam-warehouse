INSERT INTO "PermissionGroup" ("id", "code", "name", "description", "active", "system", "createdAt", "updatedAt")
VALUES
  ('pg_admin', 'admin', 'Administrador', 'Acesso completo à plataforma, usuários, permissões e audit log.', true, true, now(), now()),
  ('pg_credito', 'credito', 'Crédito', 'Análise de cedentes, sacados e motor de elegibilidade.', true, false, now(), now()),
  ('pg_operacoes', 'operacoes', 'Operações', 'Importação, compra de ativos e gestão operacional da carteira.', true, false, now(), now()),
  ('pg_comite', 'comite', 'Comitê', 'Visão executiva e aprovação de exceções.', true, false, now(), now()),
  ('pg_consulta', 'consulta', 'Consulta', 'Acesso somente leitura para acompanhamento e relatórios.', true, false, now(), now())
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "active" = EXCLUDED."active",
  "system" = EXCLUDED."system",
  "updatedAt" = now();

INSERT INTO "GroupPermission" ("id", "groupId", "module", "action", "granted", "createdAt", "updatedAt")
SELECT
  'gp_admin_' || lower(replace(replace(module_name, ' ', '_'), 'ç', 'c')) || '_' || lower(action_name),
  'pg_admin',
  module_name,
  action_name::"PermissionAction",
  true,
  now(),
  now()
FROM unnest(ARRAY[
  'Dashboard',
  'Cedentes',
  'Sacados',
  'Importação',
  'Elegibilidade',
  'Compra',
  'Carteira',
  'Documentos',
  'Relatórios',
  'Usuários',
  'Audit log'
]) AS module_name
CROSS JOIN unnest(ARRAY['VIEW', 'CREATE', 'UPDATE', 'APPROVE', 'PURCHASE', 'ADMIN']) AS action_name
ON CONFLICT ("groupId", "module", "action") DO UPDATE SET
  "granted" = EXCLUDED."granted",
  "updatedAt" = now();

INSERT INTO "User" ("id", "name", "email", "passwordHash", "role", "status", "permissionGroupId", "createdAt", "updatedAt")
VALUES
  ('usr_001', 'Felipe Martins', 'felipe@hoam.com.br', 'ae1fd358c7612a02fdc6d923fd40308ebefb0e954c7ddb6f9a8bcdd1f3b00c3b', 'ADMIN', 'ACTIVE', 'pg_admin', now(), now()),
  ('usr_002', 'Marina Andrade', 'marina@hoam.com.br', 'ae1fd358c7612a02fdc6d923fd40308ebefb0e954c7ddb6f9a8bcdd1f3b00c3b', 'CREDIT', 'ACTIVE', 'pg_credito', now(), now()),
  ('usr_003', 'Rafael Nogueira', 'rafael@hoam.com.br', 'ae1fd358c7612a02fdc6d923fd40308ebefb0e954c7ddb6f9a8bcdd1f3b00c3b', 'OPERATIONS', 'ACTIVE', 'pg_operacoes', now(), now()),
  ('usr_004', 'Comitê HOAM', 'comite@hoam.com.br', 'ae1fd358c7612a02fdc6d923fd40308ebefb0e954c7ddb6f9a8bcdd1f3b00c3b', 'COMMITTEE', 'INVITED', 'pg_comite', now(), now())
ON CONFLICT ("email") DO UPDATE SET
  "name" = EXCLUDED."name",
  "role" = EXCLUDED."role",
  "status" = EXCLUDED."status",
  "permissionGroupId" = EXCLUDED."permissionGroupId",
  "updatedAt" = now();

INSERT INTO "Assignor" ("id", "code", "legalName", "taxId", "sector", "creditLimit", "status", "createdAt", "updatedAt")
VALUES
  ('assignor_001', 'CED-001', 'Alvorada Alimentos S.A.', '12.345.678/0001-90', 'Alimentos', 12500000.00, 'ACTIVE', now(), now()),
  ('assignor_002', 'CED-002', 'Nexum Tecnologia Ltda.', '28.456.789/0001-12', 'Tecnologia', 6800000.00, 'ACTIVE', now(), now()),
  ('assignor_003', 'CED-003', 'Grupo Monte Azul', '07.654.321/0001-45', 'Logística', 9200000.00, 'REVIEW', now(), now()),
  ('assignor_004', 'CED-004', 'Vértice Indústria S.A.', '51.100.700/0001-22', 'Indústria', 15000000.00, 'ACTIVE', now(), now())
ON CONFLICT ("code") DO UPDATE SET
  "legalName" = EXCLUDED."legalName",
  "taxId" = EXCLUDED."taxId",
  "sector" = EXCLUDED."sector",
  "creditLimit" = EXCLUDED."creditLimit",
  "status" = EXCLUDED."status",
  "updatedAt" = now();

INSERT INTO "Debtor" ("id", "code", "legalName", "taxId", "rating", "exposureLimit", "status", "createdAt", "updatedAt")
VALUES
  ('debtor_182', 'SAC-182', 'Rede Nacional de Varejo S.A.', '44.123.876/0001-02', 'AA', 3840000.00, 'ACTIVE', now(), now()),
  ('debtor_144', 'SAC-144', 'Distribuidora Horizonte Ltda.', '19.882.210/0001-65', 'A', 2260000.00, 'ACTIVE', now(), now()),
  ('debtor_097', 'SAC-097', 'Mercantil Paulista S.A.', '03.448.760/0001-19', 'BBB', 1180000.00, 'REVIEW', now(), now()),
  ('debtor_211', 'SAC-211', 'Comercial Aurora Ltda.', '08.271.332/0001-75', 'A', 728000.00, 'ACTIVE', now(), now())
ON CONFLICT ("code") DO UPDATE SET
  "legalName" = EXCLUDED."legalName",
  "taxId" = EXCLUDED."taxId",
  "rating" = EXCLUDED."rating",
  "exposureLimit" = EXCLUDED."exposureLimit",
  "status" = EXCLUDED."status",
  "updatedAt" = now();

INSERT INTO "AuditLog" ("id", "userId", "action", "entityType", "entityId", "createdAt")
VALUES
  ('audit_seed_001', 'usr_001', 'DATABASE_SEEDED', 'System', 'Warehousing', now())
ON CONFLICT ("id") DO NOTHING;

