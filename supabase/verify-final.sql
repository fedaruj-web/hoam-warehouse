SELECT 'tables' AS metric, count(*)::int AS total
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
UNION ALL
SELECT 'rls_enabled', count(*)::int
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = true
UNION ALL
SELECT 'assignors', count(*)::int FROM "Assignor"
UNION ALL
SELECT 'debtors', count(*)::int FROM "Debtor"
UNION ALL
SELECT 'users', count(*)::int FROM "User"
UNION ALL
SELECT 'admin_permissions', count(*)::int FROM "GroupPermission" WHERE "groupId" = 'pg_admin';

