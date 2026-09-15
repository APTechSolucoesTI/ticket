import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CircleDollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/empty-stub";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
      return (data ?? []) as ContractRow[];
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
    <section className="space-y-4 p-6" aria-labelledby="accounts-payable-title">
      <PageHeader
        title="Contas a pagar"
        titleId="accounts-payable-title"
        subtitle="Lançamentos contratuais e manuais, aprovações, rateios e pagamentos."
        icon={CircleDollarSign}
      />
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
              <Label>Empresa operadora</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
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
            <SupplierPayables companyId={companyId} contracts={options} canEdit={canEdit} />
          )}
        </>
      )}
    </section>
  );
}
