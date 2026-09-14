import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BankReconciliationDashboard } from "@/components/bank-reconciliation-dashboard";
import { InterBindingDialog } from "@/components/inter-binding-dialog";
import { useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/finance/banking")({
  component: BankingPage,
});

function BankingPage() {
  const access = useModulePermissions("financeiro");
  const [operatorOpen, setOperatorOpen] = useState(false);
  return (
    <div className="space-y-4">
      <BankReconciliationDashboard
        canEdit={access.edit}
        onConfigureOperator={() => setOperatorOpen(true)}
      />
      {operatorOpen && <InterBindingDialog onClose={() => setOperatorOpen(false)} />}
    </div>
  );
}
