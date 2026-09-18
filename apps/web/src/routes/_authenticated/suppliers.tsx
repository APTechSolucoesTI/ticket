import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Building2,
  Eye,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Truck,
} from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { ConfigurableTable, type ListColumn } from "@/components/configurable-table";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { PageHeader } from "@/components/empty-stub";
import { SupplierBankAccountsDialog } from "@/components/supplier-bank-accounts-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  cnaeSchema,
  extractCnaesFromCnpjLookup,
  formatCnaeCode,
  parseStoredCnaes,
  type Cnae,
} from "@/lib/cnae";
import {
  isValidCNPJ,
  isValidWebsite,
  maskCEP,
  maskCNPJ,
  maskPhone,
  normalizePhone,
  unmask,
} from "@/lib/masks";
import { ReadOnlyNotice, ReadOnlyProvider, useModulePermissions } from "@/lib/permission-ui";
import { getMyTenantId } from "@/lib/tenant";
import { getUserFacingError, getValidationErrorMessage } from "@/lib/user-facing-error";

export const Route = createFileRoute("/_authenticated/suppliers")({
  head: () => ({ meta: [{ title: "Fornecedores - APTicket" }] }),
  component: SuppliersPage,
});

type SupplierCategory =
  "software_licensing" | "datacenter" | "connectivity" | "professional_services" | "other";

type OperatingCompany = { id: string; legal_name: string };
type Supplier = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string | null;
  category: SupplierCategory;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address_zip: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  cnaes: Cnae[];
  notes: string | null;
  is_active: boolean;
};

const db = supabase as unknown as SupabaseClient;
const categories: Array<{ value: SupplierCategory; label: string }> = [
  { value: "software_licensing", label: "Licenciamento de software" },
  { value: "datacenter", label: "Datacenter e cloud" },
  { value: "connectivity", label: "Conectividade" },
  { value: "professional_services", label: "Serviços profissionais" },
  { value: "other", label: "Outros" },
];

const schema = z.object({
  legal_name: z.string().trim().min(2, "Informe a razão social.").max(250),
  trade_name: z.string().trim().max(250).optional().or(z.literal("")),
  tax_id: z.string().refine(isValidCNPJ, "Informe um CNPJ válido."),
  category: z.enum([
    "software_licensing",
    "datacenter",
    "connectivity",
    "professional_services",
    "other",
  ]),
  contact_name: z.string().trim().max(150).optional().or(z.literal("")),
  email: z.union([z.literal(""), z.email("Informe um e-mail válido.")]),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || unmask(value).length >= 10, "Telefone inválido."),
  website: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || isValidWebsite(value), "Website inválido."),
  address_zip: z
    .string()
    .trim()
    .max(10)
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || unmask(value).length === 8, "CEP inválido."),
  address_street: z.string().trim().max(200).optional().or(z.literal("")),
  address_number: z.string().trim().max(20).optional().or(z.literal("")),
  address_complement: z.string().trim().max(120).optional().or(z.literal("")),
  address_neighborhood: z.string().trim().max(120).optional().or(z.literal("")),
  address_city: z.string().trim().max(100).optional().or(z.literal("")),
  address_state: z.string().trim().max(2).optional().or(z.literal("")),
  cnaes: z.array(cnaeSchema).max(200),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
  is_active: z.boolean(),
});

function SuppliersPage() {
  const access = useModulePermissions("fornecedores");
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | SupplierCategory>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [toArchive, setToArchive] = useState<Supplier | null>(null);
  const [bankTarget, setBankTarget] = useState<Supplier | null>(null);

  const companies = useQuery({
    queryKey: ["supplier-operating-companies"],
    queryFn: async () => {
      const { data, error } = await db
        .from("operating_companies")
        .select("id,legal_name")
        .is("deleted_at", null)
        .order("legal_name");
      if (error) throw error;
      return (data ?? []) as OperatingCompany[];
    },
  });

  useEffect(() => {
    if (!companyId && companies.data?.[0]) setCompanyId(companies.data[0].id);
  }, [companyId, companies.data]);

  const suppliers = useQuery({
    queryKey: ["supplier-directory"],
    queryFn: async () => {
      const { data, error } = await db
        .from("suppliers")
        .select(
          "id,legal_name,trade_name,tax_id,category,contact_name,email,phone,website,address_zip,address_street,address_number,address_complement,address_neighborhood,address_city,address_state,cnaes,notes,is_active",
        )
        .is("deleted_at", null)
        .order("legal_name");
      if (error) throw error;
      return (data ?? []).map((supplier) => ({
        ...supplier,
        cnaes: parseStoredCnaes(supplier.cnaes),
      })) as Supplier[];
    },
  });

  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (suppliers.data ?? []).filter((supplier) => {
      const primaryCnae = supplier.cnaes.find((item) => item.is_primary);
      const searchable =
        `${supplier.legal_name} ${supplier.trade_name ?? ""} ${supplier.tax_id ?? ""} ${primaryCnae?.code ?? ""} ${primaryCnae?.description ?? ""}`.toLocaleLowerCase(
          "pt-BR",
        );
      return (
        (category === "all" || supplier.category === category) &&
        (!term || searchable.includes(term))
      );
    });
  }, [category, search, suppliers.data]);

  const archive = useMutation({
    mutationFn: async (supplier: Supplier) => {
      const { error } = await db
        .from("suppliers")
        .update({ is_active: false, deleted_at: new Date().toISOString() })
        .eq("id", supplier.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Fornecedor arquivado.");
      setToArchive(null);
      void queryClient.invalidateQueries({ queryKey: ["supplier-directory"] });
      void queryClient.invalidateQueries({ queryKey: ["payable-suppliers", companyId] });
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível arquivar o fornecedor.")),
  });

  const columns: ListColumn<Supplier>[] = [
    {
      key: "name",
      label: "Fornecedor",
      className: "font-medium",
      accessor: (supplier) => `${supplier.legal_name} ${supplier.trade_name ?? ""}`,
      cell: (supplier) => (
        <div className="flex items-center gap-2">
          <Truck className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate">{supplier.trade_name || supplier.legal_name}</div>
            {supplier.trade_name ? (
              <div className="max-w-72 truncate text-xs text-muted-foreground">
                {supplier.legal_name}
              </div>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "cnpj",
      label: "CNPJ",
      accessor: (supplier) => supplier.tax_id ?? "",
      cell: (supplier) => (supplier.tax_id ? maskCNPJ(supplier.tax_id) : "-"),
    },
    {
      key: "cnae",
      label: "CNAE principal",
      accessor: (supplier) => {
        const primary = supplier.cnaes.find((item) => item.is_primary);
        return primary ? `${primary.code} ${primary.description}` : "";
      },
      cell: (supplier) => {
        const primary = supplier.cnaes.find((item) => item.is_primary);
        return primary ? (
          <div className="max-w-64" title={primary.description}>
            <Badge variant="secondary" className="font-mono">
              {formatCnaeCode(primary.code)}
            </Badge>
            <div className="mt-1 truncate text-xs text-muted-foreground">{primary.description}</div>
          </div>
        ) : (
          "-"
        );
      },
    },
    {
      key: "category",
      label: "Categoria",
      accessor: (supplier) =>
        categories.find((item) => item.value === supplier.category)?.label ?? "",
      cell: (supplier) => categories.find((item) => item.value === supplier.category)?.label ?? "-",
    },
    {
      key: "phone",
      label: "Telefone",
      cell: (supplier) => (supplier.phone ? maskPhone(supplier.phone) : "-"),
    },
    {
      key: "city",
      label: "Cidade",
      accessor: (supplier) => supplier.address_city ?? "",
      cell: (supplier) => supplier.address_city || "-",
    },
    {
      key: "state",
      label: "UF",
      accessor: (supplier) => supplier.address_state ?? "",
      cell: (supplier) => supplier.address_state || "-",
    },
    {
      key: "status",
      label: "Status",
      accessor: (supplier) => (supplier.is_active ? "Ativo" : "Inativo"),
      cell: (supplier) => (
        <Badge variant={supplier.is_active ? "secondary" : "outline"}>
          {supplier.is_active ? "Ativo" : "Inativo"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="Fornecedores"
        subtitle="Empresas fornecedoras, atividades econômicas e dados para contas a pagar."
        icon={Truck}
        actions={
          access.edit ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="mr-1 size-4" /> Novo fornecedor
            </Button>
          ) : undefined
        }
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
          <Card className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <Label htmlFor="supplier-search">Buscar</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  id="supplier-search"
                  className="pl-9"
                  placeholder="Razão social, nome fantasia, CNPJ ou CNAE"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Categoria</Label>
              <Select
                value={category}
                onValueChange={(value) => setCategory(value as typeof category)}
              >
                <SelectTrigger className="mt-1 lg:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as categorias</SelectItem>
                  {categories.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>

          {suppliers.isLoading ? (
            <LoadingState label="Carregando fornecedores…" />
          ) : suppliers.isError ? (
            <ErrorState
              title="Fornecedores indisponíveis"
              description="Não foi possível carregar a listagem de fornecedores."
              action={{ label: "Tentar novamente", onClick: () => void suppliers.refetch() }}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nenhum fornecedor encontrado"
              description={
                search || category !== "all"
                  ? "Ajuste os filtros da listagem."
                  : "Cadastre o primeiro fornecedor do grupo empresarial."
              }
            />
          ) : (
            <Card className="p-3">
              <ConfigurableTable<Supplier>
                listKey="suppliers"
                rows={rows}
                rowKey={(supplier) => supplier.id}
                defaultColumns={["name", "cnpj", "cnae", "category", "phone", "status"]}
                columns={columns}
                rowActions={(supplier) => (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!companyId}
                      title="Dados bancários"
                      aria-label={`Dados bancários de ${supplier.legal_name}`}
                      onClick={() => setBankTarget(supplier)}
                    >
                      <Landmark className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${access.edit ? "Editar" : "Visualizar"} ${supplier.legal_name}`}
                      onClick={() => {
                        setEditing(supplier);
                        setOpen(true);
                      }}
                    >
                      {access.edit ? <Pencil className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                    {access.edit ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Arquivar ${supplier.legal_name}`}
                        onClick={() => setToArchive(supplier)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </>
                )}
              />
            </Card>
          )}
        </>
      )}

      <SupplierDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        readOnly={!access.edit}
      />

      {bankTarget ? (
        <SupplierBankAccountsDialog
          supplierId={bankTarget.id}
          supplierName={bankTarget.trade_name || bankTarget.legal_name}
          operatingCompanyId={companyId}
          canEdit={access.edit}
          onClose={() => setBankTarget(null)}
        />
      ) : null}

      <AlertDialog open={Boolean(toArchive)} onOpenChange={(value) => !value && setToArchive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar fornecedor?</AlertDialogTitle>
            <AlertDialogDescription>
              O fornecedor <b>{toArchive?.trade_name || toArchive?.legal_name}</b> deixará de
              aparecer nas listagens ativas. Contratos ativos precisam ser arquivados antes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={archive.isPending}
              onClick={() => toArchive && archive.mutate(toArchive)}
            >
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SupplierDialog({
  open,
  onOpenChange,
  editing,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  editing: Supplier | null;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const [lookingUp, setLookingUp] = useState(false);
  const [lookingUpCep, setLookingUpCep] = useState(false);
  const [form, setForm] = useState({
    legal_name: "",
    trade_name: "",
    tax_id: "",
    category: "other" as SupplierCategory,
    contact_name: "",
    email: "",
    phone: "",
    website: "",
    address_zip: "",
    address_street: "",
    address_number: "",
    address_complement: "",
    address_neighborhood: "",
    address_city: "",
    address_state: "",
    cnaes: [] as Cnae[],
    notes: "",
    is_active: true,
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      legal_name: editing?.legal_name ?? "",
      trade_name: editing?.trade_name ?? "",
      tax_id: editing?.tax_id ? maskCNPJ(editing.tax_id) : "",
      category: editing?.category ?? "other",
      contact_name: editing?.contact_name ?? "",
      email: editing?.email ?? "",
      phone: editing?.phone ? maskPhone(editing.phone) : "",
      website: editing?.website ?? "",
      address_zip: editing?.address_zip ? maskCEP(editing.address_zip) : "",
      address_street: editing?.address_street ?? "",
      address_number: editing?.address_number ?? "",
      address_complement: editing?.address_complement ?? "",
      address_neighborhood: editing?.address_neighborhood ?? "",
      address_city: editing?.address_city ?? "",
      address_state: editing?.address_state ?? "",
      cnaes: parseStoredCnaes(editing?.cnaes),
      notes: editing?.notes ?? "",
      is_active: editing?.is_active ?? true,
    });
  }, [editing, open]);

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof schema>) => {
      const tenantId = await getMyTenantId();
      if (!tenantId) throw new Error("Tenant não encontrado.");
      const values = {
        legal_name: payload.legal_name,
        trade_name: payload.trade_name || null,
        tax_id: unmask(payload.tax_id),
        category: payload.category,
        contact_name: payload.contact_name || null,
        email: payload.email || null,
        phone: payload.phone ? normalizePhone(payload.phone) : null,
        website: payload.website || null,
        address_zip: payload.address_zip ? unmask(payload.address_zip) : null,
        address_street: payload.address_street || null,
        address_number: payload.address_number || null,
        address_complement: payload.address_complement || null,
        address_neighborhood: payload.address_neighborhood || null,
        address_city: payload.address_city || null,
        address_state: payload.address_state ? payload.address_state.toUpperCase() : null,
        cnaes: payload.cnaes,
        notes: payload.notes || null,
        is_active: payload.is_active,
      };

      if (editing) {
        const { error } = await db.from("suppliers").update(values).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("suppliers").insert({
          ...values,
          tenant_id: tenantId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Fornecedor atualizado." : "Fornecedor criado.");
      void queryClient.invalidateQueries({ queryKey: ["supplier-directory"] });
      void queryClient.invalidateQueries({ queryKey: ["payable-suppliers"] });
      onOpenChange(false);
    },
    onError: (error: Error) =>
      toast.error(
        error.message.includes("suppliers_tax_id_key")
          ? "Já existe um fornecedor cadastrado com este CNPJ."
          : getUserFacingError(error, "Não foi possível salvar o fornecedor."),
      ),
  });

  const lookupCnpj = async () => {
    const digits = unmask(form.tax_id);
    if (digits.length !== 14 || !isValidCNPJ(digits)) {
      toast.error("Informe um CNPJ válido.");
      return;
    }
    setLookingUp(true);
    try {
      const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
      if (!response.ok) throw new Error("CNPJ não encontrado.");
      const data = (await response.json()) as Record<string, unknown>;
      const cnaes = extractCnaesFromCnpjLookup(data);
      setForm((current) => ({
        ...current,
        legal_name: String(data.razao_social || current.legal_name),
        trade_name: String(data.nome_fantasia || current.trade_name),
        phone: data.ddd_telefone_1 ? maskPhone(String(data.ddd_telefone_1)) : current.phone,
        address_zip: data.cep ? maskCEP(String(data.cep)) : current.address_zip,
        address_street: String(data.logradouro || current.address_street),
        address_number: data.numero ? String(data.numero) : current.address_number,
        address_complement: String(data.complemento || current.address_complement),
        address_neighborhood: String(data.bairro || current.address_neighborhood),
        address_city: String(data.municipio || current.address_city),
        address_state: String(data.uf || current.address_state),
        cnaes,
      }));
      toast.success(
        cnaes.length
          ? `Dados preenchidos e ${cnaes.length} CNAE${cnaes.length === 1 ? "" : "s"} localizado${cnaes.length === 1 ? "" : "s"}.`
          : "Dados preenchidos pela Receita Federal.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao consultar o CNPJ.");
    } finally {
      setLookingUp(false);
    }
  };

  const lookupCep = async () => {
    const digits = unmask(form.address_zip);
    if (digits.length !== 8) {
      toast.error("Informe um CEP válido.");
      return;
    }
    setLookingUpCep(true);
    try {
      const response = await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`);
      if (!response.ok) throw new Error("CEP não encontrado.");
      const data = await response.json();
      setForm((current) => ({
        ...current,
        address_street: data.street || current.address_street,
        address_neighborhood: data.neighborhood || current.address_neighborhood,
        address_city: data.city || current.address_city,
        address_state: data.state || current.address_state,
      }));
      toast.success("Endereço preenchido pelo CEP.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao consultar o CEP.");
    } finally {
      setLookingUpCep(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ReadOnlyProvider readOnly={readOnly}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {readOnly
                ? "Visualizar fornecedor"
                : editing
                  ? "Editar fornecedor"
                  : "Novo fornecedor"}
            </DialogTitle>
          </DialogHeader>
          <ReadOnlyNotice show={readOnly} />
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (readOnly) return;
              const result = schema.safeParse(form);
              if (!result.success) {
                toast.error(getValidationErrorMessage(result.error));
                return;
              }
              save.mutate(result.data);
            }}
          >
            <Tabs defaultValue="dados" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="dados">Dados</TabsTrigger>
                <TabsTrigger value="endereco">Endereço</TabsTrigger>
                <TabsTrigger value="atividades">
                  Atividades{form.cnaes.length ? ` (${form.cnaes.length})` : ""}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="dados" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>Razão social *</Label>
                  <Input
                    value={form.legal_name}
                    onChange={(event) => setForm({ ...form, legal_name: event.target.value })}
                  />
                </div>
                <div>
                  <Label>Nome fantasia</Label>
                  <Input
                    value={form.trade_name}
                    onChange={(event) => setForm({ ...form, trade_name: event.target.value })}
                  />
                </div>
                <div>
                  <Label>CNPJ *</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.tax_id}
                      placeholder="00.000.000/0000-00"
                      onChange={(event) => {
                        const taxId = maskCNPJ(event.target.value);
                        setForm({
                          ...form,
                          tax_id: taxId,
                          cnaes: unmask(taxId) === unmask(form.tax_id) ? form.cnaes : [],
                        });
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={readOnly || lookingUp}
                      aria-label="Consultar dados do CNPJ"
                      title="Consultar dados do CNPJ"
                      onClick={() => void lookupCnpj()}
                    >
                      {lookingUp ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Search className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div>
                  <Label>Categoria</Label>
                  <Select
                    value={form.category}
                    onValueChange={(value) =>
                      setForm({ ...form, category: value as SupplierCategory })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Contato</Label>
                  <Input
                    value={form.contact_name}
                    onChange={(event) => setForm({ ...form, contact_name: event.target.value })}
                  />
                </div>
                <div>
                  <Label>E-mail</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                  />
                </div>
                <div>
                  <Label>Telefone</Label>
                  <Input
                    value={form.phone}
                    placeholder="55 11 99999-9999"
                    onChange={(event) => setForm({ ...form, phone: maskPhone(event.target.value) })}
                  />
                </div>
                <div>
                  <Label>Website</Label>
                  <Input
                    value={form.website}
                    onChange={(event) => setForm({ ...form, website: event.target.value })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
                  <div>
                    <div className="text-sm font-medium">Fornecedor ativo</div>
                    <div className="text-xs text-muted-foreground">
                      Disponível para contratos e lançamentos.
                    </div>
                  </div>
                  <Switch
                    checked={form.is_active}
                    onCheckedChange={(value) => setForm({ ...form, is_active: value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>Observações</Label>
                  <Textarea
                    rows={3}
                    value={form.notes}
                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  />
                </div>
              </TabsContent>

              <TabsContent value="endereco" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>CEP</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.address_zip}
                      placeholder="00000-000"
                      onChange={(event) =>
                        setForm({ ...form, address_zip: maskCEP(event.target.value) })
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={readOnly || lookingUpCep}
                      aria-label="Consultar CEP"
                      title="Consultar CEP"
                      onClick={() => void lookupCep()}
                    >
                      {lookingUpCep ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Search className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div>
                  <Label>Estado (UF)</Label>
                  <Input
                    maxLength={2}
                    value={form.address_state}
                    placeholder="SP"
                    onChange={(event) =>
                      setForm({ ...form, address_state: event.target.value.toUpperCase() })
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>Logradouro</Label>
                  <Input
                    value={form.address_street}
                    onChange={(event) => setForm({ ...form, address_street: event.target.value })}
                  />
                </div>
                <div>
                  <Label>Número</Label>
                  <Input
                    value={form.address_number}
                    onChange={(event) => setForm({ ...form, address_number: event.target.value })}
                  />
                </div>
                <div>
                  <Label>Bairro</Label>
                  <Input
                    value={form.address_neighborhood}
                    onChange={(event) =>
                      setForm({ ...form, address_neighborhood: event.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Complemento</Label>
                  <Input
                    value={form.address_complement}
                    onChange={(event) =>
                      setForm({ ...form, address_complement: event.target.value })
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>Cidade</Label>
                  <Input
                    value={form.address_city}
                    onChange={(event) => setForm({ ...form, address_city: event.target.value })}
                  />
                </div>
              </TabsContent>

              <TabsContent value="atividades" className="mt-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold">Atividades econômicas da empresa</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    CNAEs obtidos na consulta do CNPJ. Faça uma nova consulta para atualizar os
                    dados públicos da Receita Federal.
                  </p>
                </div>
                {form.cnaes.length ? (
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {form.cnaes.map((cnae) => (
                      <div
                        key={cnae.code}
                        className={`rounded-lg border p-3 ${cnae.is_primary ? "border-primary/40 bg-primary/5 shadow-sm" : "bg-muted/20"}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold">
                            {formatCnaeCode(cnae.code)}
                          </span>
                          {cnae.is_primary ? <Badge>Principal</Badge> : null}
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-foreground/90">
                          {cnae.description}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center">
                    <Building2 className="mx-auto size-8 text-muted-foreground/60" />
                    <p className="mt-3 text-sm font-medium">Nenhum CNAE carregado</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Informe um CNPJ válido na aba Dados e utilize o botão de consulta.
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {readOnly ? "Fechar" : "Cancelar"}
              </Button>
              {!readOnly ? (
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Salvando…" : "Salvar"}
                </Button>
              ) : null}
            </DialogFooter>
          </form>
        </DialogContent>
      </ReadOnlyProvider>
    </Dialog>
  );
}
