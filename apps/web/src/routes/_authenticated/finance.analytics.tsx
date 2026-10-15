import { createFileRoute } from "@tanstack/react-router";
import { FinancialContractAnalytics } from "@/components/financial-contract-analytics";
import { FinancialManagementStatement } from "@/components/financial-management-statement";
import { ChartNoAxesCombined } from "lucide-react";
import { FinancialWorkspace } from "@/components/financial-workspace";

export const Route = createFileRoute("/_authenticated/finance/analytics")({
  component: AnalyticsPage,
});

function AnalyticsPage() {
  return (
    <FinancialWorkspace
      title="Resultados"
      subtitle="Rentabilidade dos contratos, projeções e demonstrativo gerencial."
      icon={ChartNoAxesCombined}
    >
      <FinancialContractAnalytics />
      <FinancialManagementStatement />
    </FinancialWorkspace>
  );
}
