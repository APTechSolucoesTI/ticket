import { createFileRoute } from "@tanstack/react-router";
import { SupplierContractsPage as SupplierContractsContent } from "@/components/supplier-contracts-page";
import { ReadOnlyNotice, ReadOnlyProvider, useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/supplier-contracts")({
  head: () => ({ meta: [{ title: "Contratos de fornecedores - APTicket" }] }),
  component: SupplierContractsPage,
});

function SupplierContractsPage() {
  const access = useModulePermissions("financeiro_contas_pagar");

  return (
    <ReadOnlyProvider readOnly={!access.edit}>
      <ReadOnlyNotice show={!access.edit} />
      <SupplierContractsContent canEdit={access.edit} />
    </ReadOnlyProvider>
  );
}
