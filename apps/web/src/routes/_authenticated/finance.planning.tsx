import { createFileRoute } from "@tanstack/react-router";
import { FinancialBudgetDashboard } from "@/components/financial-budget-dashboard";
import { useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/finance/planning")({
  component: PlanningPage,
});

function PlanningPage() {
  const access = useModulePermissions("financeiro");
  return <FinancialBudgetDashboard canEdit={access.edit} />;
}
