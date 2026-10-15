import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CircleDollarSign, FileCog, Repeat2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FinancialWorkspace } from "@/components/financial-workspace";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FinancialDocumentTypesDialog } from "@/components/financial-document-types-dialog";
import { useModulePermissions } from "@/lib/permission-ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SupplierPayables, type PayableContractOption } from "@/components/supplier-payables";

type Company = { id: string; legal_name: string };
type ContractRow = {
  id: string;
  description: string;
  billing_unit: PayableContractOption["billingUnit"];
  billing_interval_months: number;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  suppliers: { legal_name: string; trade_name: string | null; is_active: boolean } | null;
};

const db = supabase as unknown as SupabaseClient;

export function AccountsPayablePage({ canEdit }: { canEdit: boolean }) {
  const [companyId, setCompanyId] = useState("");
  const [documentTypesOpen, setDocumentTypesOpen] = useState(false);
  const fixedAccess = useModulePermissions("financeiro_contas_fixas");
  const companies = useQuery({
    queryKey: ["payable-operating-companies"],
    queryFn: async () => {
      const { data, error } = await db
        .from("operating_companies")
        .select("id,legal_name")
        .is("deleted_at", null)
        .order("legal_name");
      if (error) throw error;
      return (data ?? []) as Company[];
    },
  });
  useEffect(() => {
    if (!companyId && companies.data?.[0]) setCompanyId(companies.data[0].id);
  }, [companyId, companies.data]);
  const contracts = useQuery({
    queryKey: ["payable-contract-options", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await db
        .from("supplier_contracts")
        .select(
          "id,description,billing_unit,billing_interval_months,starts_at,ends_at,is_active,suppliers(legal_name,trade_name,is_active)",
        )
        .eq("operating_company_id", companyId)
        .is("deleted_at", null)
        .order("description");
      if (error) throw error;
      return (data ?? []) as unknown as ContractRow[];
    },
  });
  const options = useMemo<PayableContractOption[]>(
    () =>
      (contracts.data ?? []).map((contract) => ({
        id: contract.id,
        supplierName:
          contract.suppliers?.trade_name || contract.suppliers?.legal_name || "Fornecedor",
        description: contract.description,
        billingUnit: contract.billing_unit,
        intervalMonths: contract.billing_interval_months,
        startsAt: contract.starts_at,
        endsAt: contract.ends_at,
        active: contract.is_active && Boolean(contract.suppliers?.is_active),
      })),
    [contracts.data],
  );

  return (
    <FinancialWorkspace
      title="Contas a pagar"
      titleId="accounts-payable-title"
      subtitle="Lançamentos contratuais e manuais, aprovações, rateios e pagamentos."
      icon={CircleDollarSign}
      actions={
        canEdit ? (
          <>
            {fixedAccess.view ? (
              <Button variant="outline" asChild>
                <Link to="/finance/payables/fixed">
                  <Repeat2 className="size-4" />
                  Contas fixas
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setDocumentTypesOpen(true)}>
              <FileCog className="size-4" />
              Tipos de documento
            </Button>
          </>
        ) : undefined
      }
    >
      {companies.isLoading ? (
        <LoadingState label="Carregando empresas…" />
      ) : companies.isError ? (
        <ErrorState
          title="Empresas indisponíveis"
          description="Não foi possível consultar seu acesso financeiro."
          action={{ label: "Tentar novamente", onClick: () => void companies.refetch() }}
        />
      ) : !companies.data?.length ? (
        <EmptyState
          title="Sem empresa operadora"
          description="Solicite ao administrador o vínculo financeiro com uma empresa operadora."
        />
      ) : (
        <>
          <Card>
            <CardContent className="max-w-md p-4">
              <Label htmlFor="payable-company">Empresa operadora</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger id="payable-company" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="[&_[cmdk-item]]:text-xs">
                  {companies.data.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.legal_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
          {contracts.isLoading ? (
            <LoadingState label="Carregando contratos…" />
          ) : contracts.isError ? (
            <ErrorState
              title="Contratos indisponíveis"
              description="As contas manuais continuam disponíveis após atualizar a consulta."
              action={{ label: "Tentar novamente", onClick: () => void contracts.refetch() }}
            />
          ) : (
            <SupplierPayables
              companyId={companyId}
              companyName={
                companies.data.find((company) => company.id === companyId)?.legal_name ??
                "Empresa operadora indisponível."
              }
              contracts={options}
              canEdit={canEdit}
            />
          )}
        </>
      )}
      <FinancialDocumentTypesDialog
        open={documentTypesOpen}
        onClose={() => setDocumentTypesOpen(false)}
      />
    </FinancialWorkspace>
  );
}
