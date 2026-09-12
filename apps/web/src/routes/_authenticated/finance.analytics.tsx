import { createFileRoute } from "@tanstack/react-router";
import { FinancialContractAnalytics } from "@/components/financial-contract-analytics";
import { FinancialManagementStatement } from "@/components/financial-management-statement";

export const Route = createFileRoute("/_authenticated/finance/analytics")({
  component: AnalyticsPage,
});

function AnalyticsPage() {
  return (
    <div className="space-y-5">
      <FinancialContractAnalytics />
      <FinancialManagementStatement />
    </div>
  );
}
