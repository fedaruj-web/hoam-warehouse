SELECT "groupId", count(*)::int AS permissions
FROM "GroupPermission"
GROUP BY "groupId"
ORDER BY "groupId";

