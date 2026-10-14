import { createFileRoute } from "@tanstack/react-router";
import { FixedPayablesPage } from "@/components/fixed-payables-page";

export const Route = createFileRoute("/_authenticated/finance/payables_/fixed")({
  component: FixedPayablesPage,
});
