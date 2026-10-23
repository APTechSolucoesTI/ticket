import { createFileRoute } from "@tanstack/react-router";
import { SupplierContractsPage as SupplierContractsContent } from "@/components/supplier-contracts-page";
import { ReadOnlyNotice, ReadOnlyProvider, useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/supplier-contracts")({
  head: () => ({ meta: [{ title: "Contratos de fornecedores - APTicket" }] }),
  component: SupplierContractsPage,
});

function SupplierContractsPage() {
  const access = useModulePermissions("contratos_fornecedores");

  return (
    <ReadOnlyProvider readOnly={!access.edit && !access.create}>
      <ReadOnlyNotice show={!access.edit && !access.create} />
      <SupplierContractsContent
        canCreate={access.create}
        canEdit={access.edit}
        canDelete={access.delete}
      />
    </ReadOnlyProvider>
  );
}
