import { createFileRoute } from "@tanstack/react-router";
import { CashFlowDashboard } from "@/components/cash-flow-dashboard";
import { useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/finance/cash-flow")({
  component: CashFlowPage,
});

function CashFlowPage() {
  const access = useModulePermissions("financeiro_fluxo_caixa");
  return <CashFlowDashboard canEdit={access.edit} />;
}
