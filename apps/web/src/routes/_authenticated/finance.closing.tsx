import { createFileRoute } from "@tanstack/react-router";
import { FinancialPeriodClosure } from "@/components/financial-period-closure";
import { useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/finance/closing")({
  component: ClosingPage,
});

function ClosingPage() {
  const access = useModulePermissions("financeiro");
  return <FinancialPeriodClosure canEdit={access.edit} />;
}
