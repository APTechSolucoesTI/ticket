import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Building2 } from "lucide-react";
import { BankReconciliationDashboard } from "@/components/bank-reconciliation-dashboard";
import { InterBindingDialog } from "@/components/inter-binding-dialog";
import { Button } from "@/components/ui/button";
import { useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/finance/banking")({
  component: BankingPage,
});

function BankingPage() {
  const access = useModulePermissions("financeiro");
  const [operatorOpen, setOperatorOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => setOperatorOpen(true)}>
          <Building2 className="mr-2 size-4" /> Empresa operadora e Banco Inter
        </Button>
      </div>
      <BankReconciliationDashboard canEdit={access.edit} />
      {operatorOpen && <InterBindingDialog onClose={() => setOperatorOpen(false)} />}
    </div>
  );
}
