INSERT INTO "GroupPermission" ("id", "groupId", "module", "action", "granted", "createdAt", "updatedAt")
SELECT
  'gp_admin_' || row_number() over ()::text,
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

