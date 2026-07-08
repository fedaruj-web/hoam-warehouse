DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'User',
    'UserSession',
    'PermissionGroup',
    'GroupPermission',
    'Assignor',
    'Debtor',
    'ImportBatch',
    'Receivable',
    'EligibilityRule',
    'EligibilityEvaluation',
    'Purchase',
    'PurchaseItem',
    'PortfolioItem',
    'Document',
    'CashMovement',
    'FundingIssue',
    'WorkflowTransition',
    'AuditLog'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

