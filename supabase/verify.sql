SELECT 'PermissionGroup' AS table_name, count(*)::int AS total FROM "PermissionGroup"
UNION ALL SELECT 'User', count(*)::int FROM "User"
UNION ALL SELECT 'Assignor', count(*)::int FROM "Assignor"
UNION ALL SELECT 'Debtor', count(*)::int FROM "Debtor"
UNION ALL SELECT 'AuditLog', count(*)::int FROM "AuditLog";

