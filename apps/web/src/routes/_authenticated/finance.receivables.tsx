import { createFileRoute } from "@tanstack/react-router";
import { FinanceReceivablesPage } from "@/components/finance-receivables-page";

export const Route = createFileRoute("/_authenticated/finance/receivables")({
  component: FinanceReceivablesPage,
});
