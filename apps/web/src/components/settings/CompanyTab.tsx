import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Building2, Loader2, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyTenantId } from "@/lib/tenant";
import { maskCNPJ, maskCEP, maskPhone, normalizePhone } from "@/lib/masks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReadOnlyNotice, ReadOnlyProvider, useModulePermissions } from "@/lib/permission-ui";
import { getUserFacingError } from "@/lib/user-facing-error";
import {
  extractCnaesFromCnpjLookup,
  formatCnaeCode,
  parseStoredCnaes,
  type Cnae,
} from "@/lib/cnae";

type TenantRow = {
  id: string;
  name: string;
  legal_name: string | null;
  trade_name: string | null;
  cnpj: string | null;
  cnaes: Cnae[];
  state_registration: string | null;
  municipal_registration: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  support_email: string | null;
  support_phone: string | null;
  zip_code: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_district: string | null;
  address_city: string | null;
  address_state: string | null;
  address_country: string | null;
  logo_url: string | null;
  primary_color: string | null;
  timezone: string | null;
  business_hours_start: string | null;
  business_hours_end: string | null;
  business_days: string[] | null;
  notes: string | null;
};

const emptyForm: Omit<TenantRow, "id"> = {
  name: "",
  legal_name: "",
  trade_name: "",
  cnpj: "",
  cnaes: [],
  state_registration: "",
  municipal_registration: "",
  email: "",
  phone: "",
  whatsapp: "",
  website: "",
  support_email: "",
  support_phone: "",
  zip_code: "",
  address_street: "",
  address_number: "",
  address_complement: "",
  address_district: "",
  address_city: "",
  address_state: "",
  address_country: "BR",
  logo_url: "",
  primary_color: "",
  timezone: "America/Sao_Paulo",
  business_hours_start: "08:00",
  business_hours_end: "18:00",
  business_days: ["mon", "tue", "wed", "thu", "fri"],
  notes: "",
};

const WEEKDAYS: { id: string; label: string }[] = [
  { id: "mon", label: "Seg" },
  { id: "tue", label: "Ter" },
  { id: "wed", label: "Qua" },
  { id: "thu", label: "Qui" },
  { id: "fri", label: "Sex" },
  { id: "sat", label: "Sáb" },
  { id: "sun", label: "Dom" },
];

async function requireTenantId() {
  const tenantId = await getMyTenantId();
  if (!tenantId) throw new Error("Tenant não encontrado");
  return tenantId;
}

export function CompanyTab() {
  const qc = useQueryClient();
  const access = useModulePermissions("empresa");
  const {
    data: tenant,
    error: tenantError,
    isError: isTenantError,
    isFetching: isTenantFetching,
    isLoading,
    refetch: refetchTenant,
  } = useQuery({
    queryKey: ["tenant-config"],
    queryFn: async (): Promise<TenantRow | null> => {
      const tid = await requireTenantId();
      const { data, error } = await supabase
        .from("tenants")
        .select(
          "id, name, legal_name, trade_name, cnpj, cnaes, state_registration, municipal_registration, email, phone, whatsapp, website, support_email, support_phone, zip_code, address_street, address_number, address_complement, address_district, address_city, address_state, address_country, logo_url, primary_color, timezone, business_hours_start, business_hours_end, business_days, notes",
        )
        .eq("id", tid)
        .maybeSingle();
      if (error) throw error;
      return (data as TenantRow) ?? null;
    },
  });

  const [form, setForm] = useState(emptyForm);
  const [lookingUpCnpj, setLookingUpCnpj] = useState(false);
  const [lookingUpCep, setLookingUpCep] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setForm({
      name: tenant.name ?? "",
      legal_name: tenant.legal_name ?? "",
      trade_name: tenant.trade_name ?? "",
      cnpj: tenant.cnpj ? maskCNPJ(tenant.cnpj) : "",
      cnaes: parseStoredCnaes(tenant.cnaes),
      state_registration: tenant.state_registration ?? "",
      municipal_registration: tenant.municipal_registration ?? "",
      email: tenant.email ?? "",
      phone: tenant.phone ? maskPhone(tenant.phone) : "",
      whatsapp: tenant.whatsapp ? maskPhone(tenant.whatsapp) : "",
      website: tenant.website ?? "",
      support_email: tenant.support_email ?? "",
      support_phone: tenant.support_phone ? maskPhone(tenant.support_phone) : "",
      zip_code: tenant.zip_code ? maskCEP(tenant.zip_code) : "",
      address_street: tenant.address_street ?? "",
      address_number: tenant.address_number ?? "",
      address_complement: tenant.address_complement ?? "",
      address_district: tenant.address_district ?? "",
      address_city: tenant.address_city ?? "",
      address_state: tenant.address_state ?? "",
      address_country: tenant.address_country ?? "BR",
      logo_url: tenant.logo_url ?? "",
      primary_color: tenant.primary_color ?? "",
      timezone: tenant.timezone ?? "America/Sao_Paulo",
      business_hours_start: tenant.business_hours_start?.slice(0, 5) ?? "08:00",
      business_hours_end: tenant.business_hours_end?.slice(0, 5) ?? "18:00",
      business_days: tenant.business_days ?? ["mon", "tue", "wed", "thu", "fri"],
      notes: tenant.notes ?? "",
    });
  }, [tenant]);

  const save = useMutation({
    mutationFn: async () => {
      if (!access.edit) throw new Error("Sem permissão para editar a empresa");
      const tid = await requireTenantId();
      const payload = {
        ...form,
        name: form.name.trim() || form.trade_name?.trim() || form.legal_name?.trim() || "Empresa",
        phone: form.phone ? normalizePhone(form.phone) : null,
        whatsapp: form.whatsapp ? normalizePhone(form.whatsapp) : null,
        support_phone: form.support_phone ? normalizePhone(form.support_phone) : null,
      };
      const { error } = await supabase.from("tenants").update(payload).eq("id", tid);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configurações salvas.");
      qc.invalidateQueries({ queryKey: ["tenant-config"] });
    },
    onError: (e: Error) =>
      toast.error(getUserFacingError(e, "Não foi possível salvar os dados da empresa.")),
  });

  const lookupCnpj = async () => {
    const digits = (form.cnpj ?? "").replace(/\D/g, "");
    if (digits.length !== 14) {
      toast.error("Informe um CNPJ válido (14 dígitos).");
      return;
    }
    setLookingUpCnpj(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
      if (!res.ok) throw new Error("CNPJ não localizado.");
      const d = (await res.json()) as Record<string, unknown>;
      const cnaes = extractCnaesFromCnpjLookup(d);
      setForm((f) => ({
        ...f,
        legal_name: String(d.razao_social || f.legal_name),
        trade_name: String(d.nome_fantasia || f.trade_name),
        name: String(f.name || d.nome_fantasia || d.razao_social || f.name),
        email: String(d.email || f.email),
        phone: d.ddd_telefone_1 ? maskPhone(String(d.ddd_telefone_1)) : f.phone,
        zip_code: d.cep ? maskCEP(String(d.cep)) : f.zip_code,
        address_street: String(d.logradouro || f.address_street),
        address_number: String(d.numero || f.address_number),
        address_complement: String(d.complemento || f.address_complement),
        address_district: String(d.bairro || f.address_district),
        address_city: String(d.municipio || f.address_city),
        address_state: String(d.uf || f.address_state),
        cnaes,
      }));
      toast.success(
        cnaes.length
          ? `Dados carregados e ${cnaes.length} CNAE${cnaes.length === 1 ? "" : "s"} localizado${cnaes.length === 1 ? "" : "s"}.`
          : "Dados do CNPJ carregados.",
      );
    } catch (e) {
      toast.error(getUserFacingError(e, "Não foi possível consultar o CNPJ."));
    } finally {
      setLookingUpCnpj(false);
    }
  };

  const lookupCep = async () => {
    const digits = (form.zip_code ?? "").replace(/\D/g, "");
    if (digits.length !== 8) {
      toast.error("Informe um CEP válido (8 dígitos).");
      return;
    }
    setLookingUpCep(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`);
      if (!res.ok) throw new Error("CEP não localizado.");
      const d = await res.json();
      setForm((f) => ({
        ...f,
        address_street: d.street ?? f.address_street,
        address_district: d.neighborhood ?? f.address_district,
        address_city: d.city ?? f.address_city,
        address_state: d.state ?? f.address_state,
      }));
      toast.success("Endereço carregado.");
    } catch (e) {
      toast.error(getUserFacingError(e, "Não foi possível consultar o CEP."));
    } finally {
      setLookingUpCep(false);
    }
  };

  const toggleDay = (id: string) => {
    setForm((f) => ({
      ...f,
      business_days: f.business_days?.includes(id)
        ? f.business_days.filter((d) => d !== id)
        : [...(f.business_days ?? []), id],
    }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
      </div>
    );
  }

  if (isTenantError) {
    return (
      <Card className="flex flex-col items-start gap-3 border-destructive/30 p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <h3 className="text-sm font-semibold">Não foi possível carregar os dados da empresa</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {getUserFacingError(
                tenantError,
                "O cadastro permanece armazenado. Tente carregar os dados novamente.",
              )}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void refetchTenant()}
          disabled={isTenantFetching}
        >
          {isTenantFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Tentar novamente
        </Button>
      </Card>
    );
  }

  return (
    <ReadOnlyProvider readOnly={!access.edit}>
      <div className="space-y-3">
        <ReadOnlyNotice show={!access.edit} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (access.edit) save.mutate();
          }}
          className="space-y-4"
        >
          <Card className="p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Identificação</h3>
              <p className="text-xs text-muted-foreground">
                Dados legais e comerciais da empresa MSP.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <Label>Nome de exibição *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="md:col-span-2">
                <Label>Razão social</Label>
                <Input
                  value={form.legal_name ?? ""}
                  onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <Label>Nome fantasia</Label>
                <Input
                  value={form.trade_name ?? ""}
                  onChange={(e) => setForm({ ...form, trade_name: e.target.value })}
                />
              </div>
              <div>
                <Label>CNPJ</Label>
                <div className="flex gap-1">
                  <Input
                    value={form.cnpj ?? ""}
                    onChange={(e) => {
                      const cnpj = maskCNPJ(e.target.value);
                      setForm({
                        ...form,
                        cnpj,
                        cnaes:
                          cnpj.replace(/\D/g, "") === (form.cnpj ?? "").replace(/\D/g, "")
                            ? form.cnaes
                            : [],
                      });
                    }}
                    placeholder="00.000.000/0000-00"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={lookupCnpj}
                    disabled={lookingUpCnpj || !access.edit}
                    aria-label="Consultar dados do CNPJ"
                    title="Consultar dados do CNPJ"
                  >
                    {lookingUpCnpj ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div>
                <Label>Inscrição estadual</Label>
                <Input
                  value={form.state_registration ?? ""}
                  onChange={(e) => setForm({ ...form, state_registration: e.target.value })}
                />
              </div>
              <div>
                <Label>Inscrição municipal</Label>
                <Input
                  value={form.municipal_registration ?? ""}
                  onChange={(e) => setForm({ ...form, municipal_registration: e.target.value })}
                />
              </div>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Atividades econômicas</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  CNAEs vinculados ao CNPJ da empresa conforme os dados públicos consultados.
                </p>
              </div>
              {form.cnaes.length > 0 && (
                <Badge variant="outline">
                  {form.cnaes.length} atividade{form.cnaes.length === 1 ? "" : "s"}
                </Badge>
              )}
            </div>

            {form.cnaes.length ? (
              <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                {form.cnaes.map((cnae) => (
                  <article
                    key={cnae.code}
                    className={`rounded-lg border p-3 ${
                      cnae.is_primary ? "border-primary/40 bg-primary/5 shadow-sm" : "bg-muted/20"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold">
                        {formatCnaeCode(cnae.code)}
                      </span>
                      {cnae.is_primary && <Badge>Principal</Badge>}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-foreground/90">
                      {cnae.description}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-7 text-center">
                <Building2 className="mx-auto h-8 w-8 text-muted-foreground/60" />
                <p className="mt-3 text-sm font-medium">Nenhum CNAE carregado</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Informe o CNPJ acima e utilize o botão de consulta para carregar as atividades.
                </p>
              </div>
            )}
          </Card>

          <Card className="p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Contato</h3>
              <p className="text-xs text-muted-foreground">
                Canais de comunicação da empresa e do suporte.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <Label>E-mail corporativo</Label>
                <Input
                  type="email"
                  value={form.email ?? ""}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input
                  value={form.phone ?? ""}
                  onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })}
                  placeholder="55 11 99999-9999"
                />
              </div>
              <div>
                <Label>WhatsApp</Label>
                <Input
                  value={form.whatsapp ?? ""}
                  onChange={(e) => setForm({ ...form, whatsapp: maskPhone(e.target.value) })}
                  placeholder="55 11 99999-9999"
                />
              </div>
              <div className="md:col-span-2">
                <Label>Site</Label>
                <Input
                  value={form.website ?? ""}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                  placeholder="https://"
                />
              </div>
              <div className="md:col-span-2">
                <Label>E-mail de suporte</Label>
                <Input
                  type="email"
                  value={form.support_email ?? ""}
                  onChange={(e) => setForm({ ...form, support_email: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <Label>Telefone de suporte</Label>
                <Input
                  value={form.support_phone ?? ""}
                  onChange={(e) => setForm({ ...form, support_phone: maskPhone(e.target.value) })}
                  placeholder="55 11 9999-9999"
                />
              </div>
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Endereço</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <div className="md:col-span-2">
                <Label>CEP</Label>
                <div className="flex gap-1">
                  <Input
                    value={form.zip_code ?? ""}
                    onChange={(e) => setForm({ ...form, zip_code: maskCEP(e.target.value) })}
                    placeholder="00000-000"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={lookupCep}
                    disabled={lookingUpCep || !access.edit}
                  >
                    {lookingUpCep ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="md:col-span-3">
                <Label>Logradouro</Label>
                <Input
                  value={form.address_street ?? ""}
                  onChange={(e) => setForm({ ...form, address_street: e.target.value })}
                />
              </div>
              <div>
                <Label>Número</Label>
                <Input
                  value={form.address_number ?? ""}
                  onChange={(e) => setForm({ ...form, address_number: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <Label>Complemento</Label>
                <Input
                  value={form.address_complement ?? ""}
                  onChange={(e) => setForm({ ...form, address_complement: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <Label>Bairro</Label>
                <Input
                  value={form.address_district ?? ""}
                  onChange={(e) => setForm({ ...form, address_district: e.target.value })}
                />
              </div>
              <div>
                <Label>Cidade</Label>
                <Input
                  value={form.address_city ?? ""}
                  onChange={(e) => setForm({ ...form, address_city: e.target.value })}
                />
              </div>
              <div>
                <Label>UF</Label>
                <Input
                  maxLength={2}
                  value={form.address_state ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, address_state: e.target.value.toUpperCase() })
                  }
                />
              </div>
              <div>
                <Label>País</Label>
                <Input
                  maxLength={2}
                  value={form.address_country ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, address_country: e.target.value.toUpperCase() })
                  }
                />
              </div>
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Marca</h3>
              <p className="text-xs text-muted-foreground">
                Personalização visual usada em e-mails e portal.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-3">
                <Label>URL do logo</Label>
                <Input
                  value={form.logo_url ?? ""}
                  onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
                  placeholder="https://..."
                />
              </div>
              <div>
                <Label>Cor primária</Label>
                <div className="flex gap-1">
                  <Input
                    type="color"
                    className="w-14 p-1"
                    value={form.primary_color || "#0EA5E9"}
                    onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                  />
                  <Input
                    value={form.primary_color ?? ""}
                    onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                    placeholder="#0EA5E9"
                  />
                </div>
              </div>
              {form.logo_url && (
                <div className="md:col-span-4">
                  <div className="rounded-md border p-3 bg-muted/30 inline-flex">
                    <img
                      src={form.logo_url}
                      alt="Prévia do logo"
                      className="max-h-16 object-contain"
                    />
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Operação</h3>
              <p className="text-xs text-muted-foreground">
                Fuso, horário comercial e dias úteis usados no cálculo de SLAs.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <Label>Fuso horário</Label>
                <Select
                  value={form.timezone ?? "America/Sao_Paulo"}
                  onValueChange={(v) => setForm({ ...form, timezone: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/Sao_Paulo">America/Sao_Paulo (GMT-3)</SelectItem>
                    <SelectItem value="America/Manaus">America/Manaus (GMT-4)</SelectItem>
                    <SelectItem value="America/Belem">America/Belem (GMT-3)</SelectItem>
                    <SelectItem value="America/Fortaleza">America/Fortaleza (GMT-3)</SelectItem>
                    <SelectItem value="America/Recife">America/Recife (GMT-3)</SelectItem>
                    <SelectItem value="America/Cuiaba">America/Cuiaba (GMT-4)</SelectItem>
                    <SelectItem value="America/Rio_Branco">America/Rio_Branco (GMT-5)</SelectItem>
                    <SelectItem value="UTC">UTC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Início do expediente</Label>
                <Input
                  type="time"
                  value={form.business_hours_start ?? ""}
                  onChange={(e) => setForm({ ...form, business_hours_start: e.target.value })}
                />
              </div>
              <div>
                <Label>Fim do expediente</Label>
                <Input
                  type="time"
                  value={form.business_hours_end ?? ""}
                  onChange={(e) => setForm({ ...form, business_hours_end: e.target.value })}
                />
              </div>
              <div className="md:col-span-4">
                <Label>Dias úteis</Label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((d) => {
                    const active = form.business_days?.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => toggleDay(d.id)}
                        disabled={!access.edit}
                        className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Observações internas</h3>
            </div>
            <Textarea
              rows={4}
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Card>

          {access.edit && (
            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Salvando..." : "Salvar configurações"}
              </Button>
            </div>
          )}
        </form>
      </div>
    </ReadOnlyProvider>
  );
}
