import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Building2, Eye, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { ConfigurableTable, type ListColumn } from "@/components/configurable-table";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { supabase } from "@/integrations/supabase/client";

type OperatingCompany = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string | null;
  state_registration: string | null;
  municipal_registration: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  zip_code: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_district: string | null;
  address_city: string | null;
  address_state: string | null;
  address_country: string;
  cnaes: Cnae[];
  is_active: boolean;
};

const db = supabase as unknown as SupabaseClient;
const operatorSchema = z.object({
  legal_name: z.string().trim().min(2, "Informe a razão social.").max(250),
  trade_name: z.string().trim().max(250).optional().or(z.literal("")),
  tax_id: z.string().refine(isValidCNPJ, "Informe um CNPJ válido."),
  state_registration: z.string().trim().max(30).optional().or(z.literal("")),
  municipal_registration: z.string().trim().max(30).optional().or(z.literal("")),
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
  zip_code: z
    .string()
    .trim()
    .max(10)
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || unmask(value).length === 8, "CEP inválido."),
  address_street: z.string().trim().max(200).optional().or(z.literal("")),
  address_number: z.string().trim().max(20).optional().or(z.literal("")),
  address_complement: z.string().trim().max(120).optional().or(z.literal("")),
  address_district: z.string().trim().max(120).optional().or(z.literal("")),
  address_city: z.string().trim().max(100).optional().or(z.literal("")),
  address_state: z.string().trim().max(2).optional().or(z.literal("")),
  address_country: z.string().trim().length(2),
  cnaes: z.array(cnaeSchema).max(200),
  is_active: z.boolean(),
});

const emptyForm: z.infer<typeof operatorSchema> = {
  legal_name: "",
  trade_name: "",
  tax_id: "",
  state_registration: "",
  municipal_registration: "",
  email: "",
  phone: "",
  website: "",
  zip_code: "",
  address_street: "",
  address_number: "",
  address_complement: "",
  address_district: "",
  address_city: "",
  address_state: "",
  address_country: "BR",
  cnaes: [],
  is_active: true,
};

export function OperatingCompaniesTab() {
  const access = useModulePermissions("empresa_operadora");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OperatingCompany | null>(null);
  const [toArchive, setToArchive] = useState<OperatingCompany | null>(null);

  const query = useQuery({
    queryKey: ["operating-companies", "settings"],
    queryFn: async () => {
      const { data, error } = await db
        .from("operating_companies")
        .select(
          "id,legal_name,trade_name,tax_id,state_registration,municipal_registration,email,phone,website,zip_code,address_street,address_number,address_complement,address_district,address_city,address_state,address_country,cnaes,is_active",
        )
        .is("deleted_at", null)
        .order("legal_name");
      if (error) throw error;
      return (data ?? []).map((company) => ({
        ...company,
        cnaes: parseStoredCnaes(company.cnaes),
      })) as OperatingCompany[];
    },
  });

  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (query.data ?? []).filter((company) =>
      `${company.legal_name} ${company.trade_name ?? ""} ${company.tax_id ?? ""} ${company.address_city ?? ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(term),
    );
  }, [query.data, search]);

  const archive = useMutation({
    mutationFn: async (company: OperatingCompany) => {
      const { error } = await db
        .from("operating_companies")
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq("id", company.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Empresa operadora arquivada.");
      setToArchive(null);
      void queryClient.invalidateQueries({ queryKey: ["operating-companies"] });
    },
    onError: (error: Error) =>
      toast.error(
        getUserFacingError(
          error,
          "Não foi possível arquivar. Verifique os contratos e lançamentos vinculados.",
        ),
      ),
  });

  const columns: ListColumn<OperatingCompany>[] = [
    {
      key: "name",
      label: "Empresa operadora",
      className: "font-medium",
      accessor: (company) => `${company.legal_name} ${company.trade_name ?? ""}`,
      cell: (company) => (
        <div className="flex items-center gap-2">
          <Building2 className="size-4 shrink-0 text-primary" />
          <div>
            <div>{company.trade_name || company.legal_name}</div>
            {company.trade_name ? (
              <div className="max-w-80 truncate text-xs text-muted-foreground">
                {company.legal_name}
              </div>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "cnpj",
      label: "CNPJ",
      accessor: (company) => company.tax_id ?? "",
      cell: (company) => (company.tax_id ? maskCNPJ(company.tax_id) : "-"),
    },
    {
      key: "city",
      label: "Cidade",
      accessor: (company) => company.address_city ?? "",
      cell: (company) => company.address_city || "-",
    },
    {
      key: "state",
      label: "UF",
      accessor: (company) => company.address_state ?? "",
      cell: (company) => company.address_state || "-",
    },
    {
      key: "status",
      label: "Status",
      accessor: (company) => (company.is_active ? "Ativa" : "Inativa"),
      cell: (company) => (
        <Badge variant={company.is_active ? "secondary" : "outline"}>
          {company.is_active ? "Ativa" : "Inativa"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="max-w-6xl space-y-4">
      <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Building2 className="size-5 text-primary" /> Empresas operadoras
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Empresas do grupo que separam contratos, medições, financeiro e integrações bancárias.
          </p>
        </div>
        {access.create ? (
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-2 size-4" /> Nova empresa operadora
          </Button>
        ) : null}
      </Card>

      <Card className="p-3">
        <div className="relative mb-3 max-w-xl">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por empresa, CNPJ ou cidade"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {query.isLoading ? (
          <LoadingState label="Carregando empresas operadoras…" />
        ) : query.isError ? (
          <ErrorState
            title="Empresas operadoras indisponíveis"
            description="Não foi possível carregar o cadastro."
            action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
          />
        ) : rows.length ? (
          <ConfigurableTable
            listKey="operating-companies"
            rows={rows}
            rowKey={(company) => company.id}
            defaultColumns={["name", "cnpj", "city", "state", "status"]}
            columns={columns}
            rowActions={(company) => (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`${access.edit ? "Editar" : "Visualizar"} ${company.legal_name}`}
                  onClick={() => {
                    setEditing(company);
                    setOpen(true);
                  }}
                >
                  {access.edit ? <Pencil className="size-4" /> : <Eye className="size-4" />}
                </Button>
                {access.delete ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Arquivar ${company.legal_name}`}
                    onClick={() => setToArchive(company)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </>
            )}
          />
        ) : (
          <EmptyState
            title="Nenhuma empresa operadora encontrada"
            description={
              search ? "Ajuste o texto da busca." : "Cadastre a primeira empresa do grupo."
            }
          />
        )}
      </Card>

      <OperatingCompanyDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        readOnly={editing ? !access.edit : !access.create}
      />

      <AlertDialog open={Boolean(toArchive)} onOpenChange={(value) => !value && setToArchive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar empresa operadora?</AlertDialogTitle>
            <AlertDialogDescription>
              A empresa <b>{toArchive?.trade_name || toArchive?.legal_name}</b> deixará de aceitar
              novos vínculos. Registros financeiros históricos serão preservados.
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

function OperatingCompanyDialog({
  open,
  onOpenChange,
  editing,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  editing: OperatingCompany | null;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [lookingUpCnpj, setLookingUpCnpj] = useState(false);
  const [lookingUpCep, setLookingUpCep] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            legal_name: editing.legal_name,
            trade_name: editing.trade_name ?? "",
            tax_id: editing.tax_id ? maskCNPJ(editing.tax_id) : "",
            state_registration: editing.state_registration ?? "",
            municipal_registration: editing.municipal_registration ?? "",
            email: editing.email ?? "",
            phone: editing.phone ? maskPhone(editing.phone) : "",
            website: editing.website ?? "",
            zip_code: editing.zip_code ? maskCEP(editing.zip_code) : "",
            address_street: editing.address_street ?? "",
            address_number: editing.address_number ?? "",
            address_complement: editing.address_complement ?? "",
            address_district: editing.address_district ?? "",
            address_city: editing.address_city ?? "",
            address_state: editing.address_state ?? "",
            address_country: editing.address_country ?? "BR",
            cnaes: parseStoredCnaes(editing.cnaes),
            is_active: editing.is_active,
          }
        : { ...emptyForm, cnaes: [] },
    );
  }, [editing, open]);

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof operatorSchema>) => {
      const tenantId = await getMyTenantId();
      if (!tenantId) throw new Error("Tenant não encontrado.");
      const values = {
        ...payload,
        tax_id: unmask(payload.tax_id),
        phone: payload.phone ? normalizePhone(payload.phone) : null,
        zip_code: payload.zip_code ? unmask(payload.zip_code) : null,
        trade_name: payload.trade_name || null,
        state_registration: payload.state_registration || null,
        municipal_registration: payload.municipal_registration || null,
        email: payload.email || null,
        website: payload.website || null,
        address_street: payload.address_street || null,
        address_number: payload.address_number || null,
        address_complement: payload.address_complement || null,
        address_district: payload.address_district || null,
        address_city: payload.address_city || null,
        address_state: payload.address_state ? payload.address_state.toUpperCase() : null,
      };
      if (editing) {
        const { error } = await db.from("operating_companies").update(values).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await db
          .from("operating_companies")
          .insert({ ...values, tenant_id: tenantId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Empresa operadora atualizada." : "Empresa operadora criada.");
      void queryClient.invalidateQueries({ queryKey: ["operating-companies"] });
      void queryClient.invalidateQueries({ queryKey: ["payable-operating-companies"] });
      onOpenChange(false);
    },
    onError: (error: Error) =>
      toast.error(
        error.message.includes("operating_companies_tax_key")
          ? "Já existe uma empresa operadora com este CNPJ."
          : getUserFacingError(error, "Não foi possível salvar a empresa operadora."),
      ),
  });

  const lookupCnpj = async () => {
    const digits = unmask(form.tax_id);
    if (!isValidCNPJ(digits)) {
      toast.error("Informe um CNPJ válido.");
      return;
    }
    setLookingUpCnpj(true);
    try {
      const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
      if (!response.ok) throw new Error("CNPJ não localizado.");
      const data = (await response.json()) as Record<string, unknown>;
      const cnaes = extractCnaesFromCnpjLookup(data);
      setForm((current) => ({
        ...current,
        legal_name: String(data.razao_social || current.legal_name),
        trade_name: String(data.nome_fantasia || current.trade_name),
        email: String(data.email || current.email),
        phone: data.ddd_telefone_1 ? maskPhone(String(data.ddd_telefone_1)) : current.phone,
        zip_code: data.cep ? maskCEP(String(data.cep)) : current.zip_code,
        address_street: String(data.logradouro || current.address_street),
        address_number: String(data.numero || current.address_number),
        address_complement: String(data.complemento || current.address_complement),
        address_district: String(data.bairro || current.address_district),
        address_city: String(data.municipio || current.address_city),
        address_state: String(data.uf || current.address_state),
        cnaes,
      }));
      toast.success("Dados da Receita Federal carregados.");
    } catch (error) {
      toast.error(getUserFacingError(error, "Não foi possível consultar o CNPJ."));
    } finally {
      setLookingUpCnpj(false);
    }
  };

  const lookupCep = async () => {
    const digits = unmask(form.zip_code);
    if (digits.length !== 8) {
      toast.error("Informe um CEP válido.");
      return;
    }
    setLookingUpCep(true);
    try {
      const response = await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`);
      if (!response.ok) throw new Error("CEP não localizado.");
      const data = await response.json();
      setForm((current) => ({
        ...current,
        address_street: data.street || current.address_street,
        address_district: data.neighborhood || current.address_district,
        address_city: data.city || current.address_city,
        address_state: data.state || current.address_state,
      }));
      toast.success("Endereço carregado.");
    } catch (error) {
      toast.error(getUserFacingError(error, "Não foi possível consultar o CEP."));
    } finally {
      setLookingUpCep(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ReadOnlyProvider readOnly={readOnly}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {readOnly
                ? "Visualizar empresa operadora"
                : editing
                  ? "Editar empresa operadora"
                  : "Nova empresa operadora"}
            </DialogTitle>
          </DialogHeader>
          <ReadOnlyNotice show={readOnly} />
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (readOnly) return;
              const result = operatorSchema.safeParse(form);
              if (!result.success) {
                toast.error(getValidationErrorMessage(result.error));
                return;
              }
              save.mutate(result.data);
            }}
          >
            <Tabs defaultValue="dados">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="dados">Dados</TabsTrigger>
                <TabsTrigger value="endereco">Endereço</TabsTrigger>
                <TabsTrigger value="atividades">
                  Atividades{form.cnaes.length ? ` (${form.cnaes.length})` : ""}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="dados" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2 lg:col-span-4">
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
                      onChange={(event) =>
                        setForm({ ...form, tax_id: maskCNPJ(event.target.value), cnaes: [] })
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={readOnly || lookingUpCnpj}
                      aria-label="Consultar CNPJ"
                      onClick={() => void lookupCnpj()}
                    >
                      {lookingUpCnpj ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Search className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div>
                  <Label>Inscrição estadual</Label>
                  <Input
                    value={form.state_registration}
                    onChange={(event) =>
                      setForm({ ...form, state_registration: event.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Inscrição municipal</Label>
                  <Input
                    value={form.municipal_registration}
                    onChange={(event) =>
                      setForm({ ...form, municipal_registration: event.target.value })
                    }
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
                    onChange={(event) => setForm({ ...form, phone: maskPhone(event.target.value) })}
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-2">
                  <Label>Website</Label>
                  <Input
                    value={form.website}
                    onChange={(event) => setForm({ ...form, website: event.target.value })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2 lg:col-span-2">
                  <div>
                    <div className="text-sm font-medium">Empresa ativa</div>
                    <div className="text-xs text-muted-foreground">
                      Permite novos contratos e movimentações financeiras.
                    </div>
                  </div>
                  <Switch
                    checked={form.is_active}
                    onCheckedChange={(value) => setForm({ ...form, is_active: value })}
                  />
                </div>
              </TabsContent>
              <TabsContent
                value="endereco"
                className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              >
                <div>
                  <Label>CEP</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.zip_code}
                      onChange={(event) =>
                        setForm({ ...form, zip_code: maskCEP(event.target.value) })
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={readOnly || lookingUpCep}
                      aria-label="Consultar CEP"
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
                  <Label>UF</Label>
                  <Input
                    maxLength={2}
                    value={form.address_state}
                    onChange={(event) =>
                      setForm({ ...form, address_state: event.target.value.toUpperCase() })
                    }
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
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
                    value={form.address_district}
                    onChange={(event) => setForm({ ...form, address_district: event.target.value })}
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
                <div>
                  <Label>Cidade</Label>
                  <Input
                    value={form.address_city}
                    onChange={(event) => setForm({ ...form, address_city: event.target.value })}
                  />
                </div>
              </TabsContent>
              <TabsContent value="atividades" className="mt-4">
                {form.cnaes.length ? (
                  <div className="max-h-80 space-y-2 overflow-y-auto">
                    {form.cnaes.map((cnae) => (
                      <div
                        key={cnae.code}
                        className={`rounded-lg border p-3 ${cnae.is_primary ? "border-primary/40 bg-primary/5" : "bg-muted/20"}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold">
                            {formatCnaeCode(cnae.code)}
                          </span>
                          {cnae.is_primary ? <Badge>Principal</Badge> : null}
                        </div>
                        <p className="mt-1 text-sm">{cnae.description}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="Nenhum CNAE carregado"
                    description="Consulte um CNPJ válido na aba Dados."
                  />
                )}
              </TabsContent>
            </Tabs>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {readOnly ? "Fechar" : "Cancelar"}
              </Button>
              {!readOnly ? (
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Salvar
                </Button>
              ) : null}
            </DialogFooter>
          </form>
        </DialogContent>
      </ReadOnlyProvider>
    </Dialog>
  );
}
