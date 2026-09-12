import { createFileRoute } from "@tanstack/react-router";
import { PayableSuppliers } from "@/components/payable-suppliers";
import { useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/finance/payables")({
  component: PayablesPage,
});

function PayablesPage() {
  const access = useModulePermissions("financeiro");
  return <PayableSuppliers canEdit={access.edit} />;
}
