import { createFileRoute } from "@tanstack/react-router";
import { AccountsPayablePage } from "@/components/accounts-payable-page";
import { useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/finance/payables")({
  component: PayablesPage,
});

function PayablesPage() {
  const access = useModulePermissions("financeiro_contas_pagar");
  return <AccountsPayablePage canEdit={access.edit} />;
}
