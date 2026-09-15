import { createFileRoute } from "@tanstack/react-router";
import { PayableSuppliers } from "@/components/payable-suppliers";
import { ReadOnlyNotice, ReadOnlyProvider, useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/supplier-contracts")({
  head: () => ({ meta: [{ title: "Contratos de fornecedores - APTicket" }] }),
  component: SupplierContractsPage,
});

function SupplierContractsPage() {
  const access = useModulePermissions("financeiro_contas_pagar");

  return (
    <ReadOnlyProvider readOnly={!access.edit}>
      <div className="space-y-4 p-6">
        <ReadOnlyNotice />
        <PayableSuppliers canEdit={access.edit} />
      </div>
    </ReadOnlyProvider>
  );
}
