import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, FileText, Eye } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { getMyTenantId } from "@/lib/tenant";
import { PageHeader, EmptyStub } from "@/components/empty-stub";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfigurableTable, type ListColumn } from "@/components/configurable-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import { ReadOnlyNotice, ReadOnlyProvider, useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/contracts")({
  head: () => ({ meta: [{ title: "Contratos - APTicket" }] }),
  component: ContractsPage,
});

type BillingModel = "hours_package" | "per_equipment" | "per_service";
type EquipmentTier = { min: number; max: number; price: number };
type ServiceItem = { reference: string; description: string; quantity: number; price: number };

type Contract = {
  id: string;
  company_id: string;
  contract_type_id: string | null;
  sla_policy_id: string | null;
  status: "active" | "suspended" | "expired" | "cancelled";
  starts_at: string;
  ends_at: string;
  billing_model: BillingModel;
  hours_monthly_quota: number;
  extra_hour_price: number;
  monthly_value: number;
  equipment_tiers: EquipmentTier[];
  service_items: ServiceItem[];
  includes_remote: boolean;
  includes_lab: boolean;
  includes_onsite: boolean;
  auto_renew: boolean;
  description: string | null;
  notes: string | null;
  companies?: { name: string } | null;
  contract_types?: { name: string } | null;
  sla_policies?: { name: string } | null;
};

const tierSchema = z.object({
  min: z.number().int().min(0),
  max: z.number().int().min(0),
  price: z.number().min(0),
});

const serviceSchema = z.object({
  reference: z.string().trim().max(60),
  description: z.string().trim().max(200),
  quantity: z.number().min(0),
  price: z.number().min(0),
});

const schema = z.object({
  company_id: z.string().uuid("Selecione um cliente"),
  contract_type_id: z.string().uuid().nullable(),
  sla_policy_id: z.string().uuid().nullable(),
  status: z.enum(["active", "suspended", "expired", "cancelled"]),
  starts_at: z.string().min(1, "Início obrigatório"),
  ends_at: z.string().min(1, "Fim obrigatório"),
  billing_model: z.enum(["hours_package", "per_equipment", "per_service"]),
  hours_monthly_quota: z.number().int().min(0),
  extra_hour_price: z.number().min(0),
  monthly_value: z.number().min(0),
  equipment_tiers: z.array(tierSchema),
  service_items: z.array(serviceSchema),
  includes_remote: z.boolean(),
  includes_lab: z.boolean(),
  includes_onsite: z.boolean(),
  auto_renew: z.boolean(),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

const statusLabel: Record<Contract["status"], string> = {
  active: "Ativo",
  suspended: "Suspenso",
  expired: "Expirado",
  cancelled: "Cancelado",
};

const billingLabel: Record<BillingModel, string> = {
  hours_package: "Pacote de horas",
  per_equipment: "Por equipamento",
  per_service: "Por serviço",
};

function ContractsPage() {
  const access = useModulePermissions("contratos");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [toDelete, setToDelete] = useState<Contract | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["contracts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contracts")
        .select("*, companies(name), contract_types(name), sla_policies(name)")
        .order("starts_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((c: any) => ({
        ...c,
        equipment_tiers: Array.isArray(c.equipment_tiers) ? c.equipment_tiers : [],
        service_items: Array.isArray(c.service_items) ? c.service_items : [],
      })) as Contract[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contracts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contrato removido");
      qc.invalidateQueries({ queryKey: ["contracts"] });
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Contratos"
        subtitle="Modelo de cobrança, inclusões técnicas, SLA e vigência."
        actions={
          access.create ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Novo contrato
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando…</Card>
      ) : !data?.length ? (
        <EmptyStub
          title="Nenhum contrato registrado"
          message="Sem contrato ativo, o sistema bloqueia a abertura de tickets para o cliente."
        />
      ) : (
        <Card className="p-3">
          <ConfigurableTable<Contract>
            listKey="contracts"
            rows={data}
            rowKey={(c) => c.id}
            defaultColumns={[
              "company",
              "type",
              "billing",
              "sla",
              "period",
              "value",
              "includes",
              "status",
            ]}
            columns={
              [
                {
                  key: "company",
                  label: "Cliente",
                  className: "font-medium",
                  cell: (c) => (
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {c.companies?.name || "-"}
                    </div>
                  ),
                },
                {
                  key: "type",
                  label: "Tipo",
                  className: "text-sm",
                  cell: (c) => c.contract_types?.name || "-",
                },
                {
                  key: "billing",
                  label: "Cobrança",
                  className: "text-sm",
                  cell: (c) => billingLabel[c.billing_model],
                },
                {
                  key: "sla",
                  label: "SLA",
                  className: "text-sm",
                  cell: (c) => c.sla_policies?.name || "-",
                },
                {
                  key: "period",
                  label: "Vigência",
                  className: "text-sm",
                  cell: (c) => `${c.starts_at} → ${c.ends_at}`,
                },
                {
                  key: "starts_at",
                  label: "Início",
                  className: "text-sm",
                  cell: (c) => c.starts_at,
                },
                { key: "ends_at", label: "Fim", className: "text-sm", cell: (c) => c.ends_at },
                {
                  key: "hours",
                  label: "Horas/mês",
                  className: "text-sm",
                  cell: (c) =>
                    c.billing_model === "hours_package" ? `${c.hours_monthly_quota}h` : "-",
                },
                {
                  key: "extra",
                  label: "Hora extra",
                  className: "text-sm",
                  cell: (c) => `R$ ${Number(c.extra_hour_price).toFixed(2)}`,
                },
                {
                  key: "value",
                  label: "Valor",
                  className: "text-sm",
                  cell: (c) => {
                    if (c.billing_model === "hours_package")
                      return `R$ ${Number(c.monthly_value).toFixed(2)}`;
                    if (c.billing_model === "per_service")
                      return `R$ ${Number(c.monthly_value).toFixed(2)}`;
                    if (!c.equipment_tiers?.length) return "-";

                    return (
                      <div className="space-y-0.5">
                        {c.equipment_tiers.map((t, i) => (
                          <div key={i} className="text-[11px]">
                            {t.min}–{t.max}: R$ {Number(t.price).toFixed(2)}
                          </div>
                        ))}
                      </div>
                    );
                  },
                },
                {
                  key: "includes",
                  label: "Inclui",
                  cell: (c) => (
                    <div className="flex flex-wrap gap-1">
                      {c.includes_remote && (
                        <Badge variant="outline" className="text-[10px]">
                          Remoto
                        </Badge>
                      )}
                      {c.includes_lab && (
                        <Badge variant="outline" className="text-[10px]">
                          Lab
                        </Badge>
                      )}
                      {c.includes_onsite && (
                        <Badge variant="outline" className="text-[10px]">
                          Visita
                        </Badge>
                      )}
                    </div>
                  ),
                },
                {
                  key: "renew",
                  label: "Renovação",
                  className: "text-sm",
                  cell: (c) => (c.auto_renew ? "Automática" : "Manual"),
                },
                {
                  key: "status",
                  label: "Status",
                  cell: (c) => (
                    <Badge variant={c.status === "active" ? "default" : "outline"}>
                      {statusLabel[c.status]}
                    </Badge>
                  ),
                },
              ] as ListColumn<Contract>[]
            }
            rowActions={(c) => (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditing(c);
                    setOpen(true);
                  }}
                >
                  {access.edit ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                {access.delete && (
                  <Button variant="ghost" size="icon" onClick={() => setToDelete(c)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          />
        </Card>
      )}

      <ContractDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        readOnly={editing ? !access.edit : !access.create}
      />

      {access.delete && (
        <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover contrato?</AlertDialogTitle>
              <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => toDelete && del.mutate(toDelete.id)}>
                Remover
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

const NONE = "__none__";

type FormState = {
  company_id: string;
  contract_type_id: string;
  sla_policy_id: string;
  status: Contract["status"];
  starts_at: string;
  ends_at: string;
  billing_model: BillingModel;
  hours_monthly_quota: number;
  extra_hour_price: number;
  monthly_value: number;
  equipment_tiers: EquipmentTier[];
  service_items: ServiceItem[];

  includes_remote: boolean;
  includes_lab: boolean;
  includes_onsite: boolean;
  auto_renew: boolean;
  description: string;
  notes: string;
};

function ContractDialog({
  open,
  onOpenChange,
  editing,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Contract | null;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>({
    company_id: "",
    contract_type_id: "",
    sla_policy_id: "",
    status: "active",
    starts_at: "",
    ends_at: "",
    billing_model: "hours_package",
    hours_monthly_quota: 0,
    extra_hour_price: 0,
    monthly_value: 0,
    equipment_tiers: [],
    service_items: [],

    includes_remote: false,
    includes_lab: false,
    includes_onsite: false,
    auto_renew: false,
    description: "",
    notes: "",
  });
  const [selectedEquipIds, setSelectedEquipIds] = useState<string[]>([]);

  const { data: companies } = useQuery({
    queryKey: ["companies", "options"],
    queryFn: async () =>
      (await supabase.from("companies").select("id, name").order("name")).data ?? [],
  });
  const { data: types } = useQuery({
    queryKey: ["contract_types", "options-full"],
    queryFn: async () =>
      (await supabase.from("contract_types").select("*").order("name")).data ?? [],
  });
  const { data: slas } = useQuery({
    queryKey: ["sla_policies", "options"],
    queryFn: async () =>
      (await supabase.from("sla_policies").select("id, name").order("name")).data ?? [],
  });

  // Equipamentos disponíveis do cliente selecionado
  const { data: companyEquipments } = useQuery({
    queryKey: ["equipments", "by-company", form.company_id],
    enabled: !!form.company_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipments")
        .select("id, name, type, brand, model, serial_number")
        .eq("company_id", form.company_id)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Vínculos existentes ao editar
  const { data: existingLinks } = useQuery({
    queryKey: ["contract_equipments", editing?.id],
    enabled: !!editing?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contract_equipments")
        .select("equipment_id")
        .eq("contract_id", editing!.id);
      if (error) throw error;
      return (data ?? []).map((r: any) => r.equipment_id as string);
    },
  });

  // Calcula valor mensal a partir da quantidade de equipamentos e das faixas
  const priceForCount = (count: number, tiers: EquipmentTier[]) => {
    const tier = tiers.find((t) => count >= t.min && count <= t.max);
    if (!tier) return 0;
    return count * Number(tier.price || 0);
  };
  const servicesTotal = (items: ServiceItem[]) =>
    items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.price || 0), 0);
  const computedMonthly =
    form.billing_model === "per_equipment"
      ? priceForCount(selectedEquipIds.length, form.equipment_tiers)
      : form.billing_model === "per_service"
        ? servicesTotal(form.service_items)
        : form.monthly_value;

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof schema>) => {
      const _tid = await getMyTenantId();
      if (!_tid) throw new Error("Tenant não encontrado");
      const prof = { tenant_id: _tid };
      if (!prof?.tenant_id) throw new Error("Tenant não encontrado");
      const finalMonthly =
        payload.billing_model === "per_equipment"
          ? priceForCount(selectedEquipIds.length, payload.equipment_tiers)
          : payload.billing_model === "per_service"
            ? servicesTotal(payload.service_items)
            : payload.monthly_value;
      const values = {
        company_id: payload.company_id,
        contract_type_id: payload.contract_type_id,
        sla_policy_id: payload.sla_policy_id,
        status: payload.status,
        starts_at: payload.starts_at,
        ends_at: payload.ends_at,
        billing_model: payload.billing_model,
        hours_monthly_quota:
          payload.billing_model === "hours_package" ? payload.hours_monthly_quota : 0,
        extra_hour_price: payload.extra_hour_price,
        monthly_value: finalMonthly,
        equipment_tiers: payload.billing_model === "per_equipment" ? payload.equipment_tiers : [],
        service_items: payload.billing_model === "per_service" ? payload.service_items : [],

        includes_remote: payload.includes_remote,
        includes_lab: payload.includes_lab,
        includes_onsite: payload.includes_onsite,
        auto_renew: payload.auto_renew,
        description: payload.description || null,
        notes: payload.notes || null,
      };
      let contractId: string;
      if (editing) {
        const { error } = await supabase.from("contracts").update(values).eq("id", editing.id);
        if (error) throw error;
        contractId = editing.id;
      } else {
        const { data: ins, error } = await supabase
          .from("contracts")
          .insert({ ...values, tenant_id: prof.tenant_id })
          .select("id")
          .single();
        if (error) throw error;
        contractId = ins.id;
      }

      // Sincroniza vínculos apenas para "per_equipment"
      if (payload.billing_model === "per_equipment") {
        const { error: delErr } = await supabase
          .from("contract_equipments")
          .delete()
          .eq("contract_id", contractId);
        if (delErr) throw delErr;
        if (selectedEquipIds.length) {
          const rows = selectedEquipIds.map((eid) => ({
            tenant_id: prof.tenant_id,
            contract_id: contractId,
            equipment_id: eid,
          }));
          const { error: insErr } = await supabase.from("contract_equipments").insert(rows);
          if (insErr) throw insErr;
        }
      } else if (editing) {
        // Se mudou para pacote de horas, limpa vínculos antigos
        await supabase.from("contract_equipments").delete().eq("contract_id", contractId);
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Contrato atualizado" : "Contrato criado");
      qc.invalidateQueries({ queryKey: ["contracts"] });
      qc.invalidateQueries({ queryKey: ["contract_equipments"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      company_id: editing?.company_id ?? "",
      contract_type_id: editing?.contract_type_id ?? "",
      sla_policy_id: editing?.sla_policy_id ?? "",
      status: editing?.status ?? "active",
      starts_at: editing?.starts_at ?? new Date().toISOString().slice(0, 10),
      ends_at:
        editing?.ends_at ??
        new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
      billing_model: editing?.billing_model ?? "hours_package",
      hours_monthly_quota: editing?.hours_monthly_quota ?? 0,
      extra_hour_price: Number(editing?.extra_hour_price ?? 0),
      monthly_value: Number(editing?.monthly_value ?? 0),
      equipment_tiers: editing?.equipment_tiers?.length
        ? editing.equipment_tiers
        : [{ min: 1, max: 10, price: 0 }],
      service_items: editing?.service_items?.length ? editing.service_items : [],
      includes_remote: editing?.includes_remote ?? false,
      includes_lab: editing?.includes_lab ?? false,
      includes_onsite: editing?.includes_onsite ?? false,
      auto_renew: editing?.auto_renew ?? false,
      description: editing?.description ?? "",
      notes: editing?.notes ?? "",
    });
    setSelectedEquipIds([]);
  }, [open, editing]);

  useEffect(() => {
    if (existingLinks) setSelectedEquipIds(existingLinks);
  }, [existingLinks]);

  // Ao trocar de cliente, limpar equipamentos selecionados de outra empresa
  useEffect(() => {
    setSelectedEquipIds((prev) => {
      if (!companyEquipments) return prev;
      const allowed = new Set(companyEquipments.map((e: any) => e.id));
      return prev.filter((id) => allowed.has(id));
    });
  }, [companyEquipments]);

  // Herdar defaults do tipo selecionado (só ao trocar, sem sobrescrever edição existente)
  const applyTypeDefaults = (typeId: string) => {
    const t: any = types?.find((x: any) => x.id === typeId);
    if (!t) {
      setForm((f) => ({ ...f, contract_type_id: typeId }));
      return;
    }
    setForm((f) => ({
      ...f,
      contract_type_id: typeId,
      billing_model: (t.billing_model as BillingModel) ?? f.billing_model,
      includes_remote: t.includes_remote ?? f.includes_remote,
      includes_lab: t.includes_lab ?? f.includes_lab,
      includes_onsite: t.includes_onsite ?? f.includes_onsite,
      equipment_tiers:
        Array.isArray(t.equipment_tiers) && t.equipment_tiers.length
          ? t.equipment_tiers
          : f.equipment_tiers,
      service_items:
        Array.isArray(t.service_items) && t.service_items.length
          ? (t.service_items as ServiceItem[]).map((s) => ({
              reference: s.reference ?? "",
              description: s.description ?? "",
              quantity: Number(s.quantity ?? 0),
              price: Number(s.price ?? 0),
            }))
          : f.service_items,
    }));
  };

  const addTier = () =>
    setForm((f) => ({
      ...f,
      equipment_tiers: [...f.equipment_tiers, { min: 0, max: 0, price: 0 }],
    }));
  const removeTier = (i: number) =>
    setForm((f) => ({ ...f, equipment_tiers: f.equipment_tiers.filter((_, idx) => idx !== i) }));
  const updateTier = (i: number, patch: Partial<EquipmentTier>) =>
    setForm((f) => ({
      ...f,
      equipment_tiers: f.equipment_tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)),
    }));

  const addService = () =>
    setForm((f) => ({
      ...f,
      service_items: [
        ...f.service_items,
        { reference: "", description: "", quantity: 1, price: 0 },
      ],
    }));
  const removeService = (i: number) =>
    setForm((f) => ({ ...f, service_items: f.service_items.filter((_, idx) => idx !== i) }));
  const updateService = (i: number, patch: Partial<ServiceItem>) =>
    setForm((f) => ({
      ...f,
      service_items: f.service_items.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ReadOnlyProvider readOnly={readOnly}>
        <DialogContent className="max-w-5xl max-h-[95vh] overflow-y-auto text-xs sm:max-h-[95vh] w-[95vw]">
          <DialogHeader>
            <DialogTitle className="text-base">
              {readOnly ? "Visualizar contrato" : editing ? "Editar contrato" : "Novo contrato"}
            </DialogTitle>
          </DialogHeader>
          <ReadOnlyNotice show={readOnly} />
          <form
            className="grid grid-cols-4 gap-2 text-xs [&_label]:text-[11px] [&_input]:h-8 [&_input]:text-xs [&_button[role=combobox]]:h-8 [&_button[role=combobox]]:text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              if (readOnly) return;
              const r = schema.safeParse({
                ...form,
                contract_type_id: form.contract_type_id || null,
                sla_policy_id: form.sla_policy_id || null,
              });
              if (!r.success) {
                toast.error(r.error.issues[0].message);
                return;
              }
              if (r.data.billing_model === "per_equipment" && r.data.equipment_tiers.length === 0) {
                toast.error("Adicione ao menos uma faixa de equipamentos");
                return;
              }
              if (r.data.billing_model === "per_service" && r.data.service_items.length === 0) {
                toast.error("Adicione ao menos um serviço");
                return;
              }

              save.mutate(r.data);
            }}
          >
            <div className="col-span-4">
              <Label>Cliente *</Label>
              <Select
                value={form.company_id}
                onValueChange={(v) => setForm({ ...form, company_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {companies?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Tipo de contrato</Label>
              <Select
                value={form.contract_type_id || NONE}
                onValueChange={(v) => applyTypeDefaults(v === NONE ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhum</SelectItem>
                  {types?.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>SLA</Label>
              <Select
                value={form.sla_policy_id || NONE}
                onValueChange={(v) => setForm({ ...form, sla_policy_id: v === NONE ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhum</SelectItem>
                  {slas?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Modelo de cobrança *</Label>
              <Select
                value={form.billing_model}
                onValueChange={(v) => setForm({ ...form, billing_model: v as BillingModel })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hours_package">Pacote de horas</SelectItem>
                  <SelectItem value="per_equipment">Por equipamento vinculado</SelectItem>
                  <SelectItem value="per_service">Por serviço vinculado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as Contract["status"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="suspended">Suspenso</SelectItem>
                  <SelectItem value="expired">Expirado</SelectItem>
                  <SelectItem value="cancelled">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Início *</Label>
              <Input
                type="date"
                value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
              />
            </div>
            <div>
              <Label>Fim *</Label>
              <Input
                type="date"
                value={form.ends_at}
                onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
              />
            </div>
            <div>
              <Label>Valor hora extra (R$)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.extra_hour_price}
                onChange={(e) => setForm({ ...form, extra_hour_price: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-end justify-between rounded-md border px-3 h-[52px]">
              <div className="text-[11px]">Renovação auto.</div>
              <Switch
                checked={form.auto_renew}
                onCheckedChange={(v) => setForm({ ...form, auto_renew: v })}
              />
            </div>

            {form.billing_model === "hours_package" ? (
              <>
                <div>
                  <Label>Horas/mês</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.hours_monthly_quota}
                    onChange={(e) =>
                      setForm({ ...form, hours_monthly_quota: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="col-span-3">
                  <Label>Valor mensal (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.monthly_value}
                    onChange={(e) => setForm({ ...form, monthly_value: Number(e.target.value) })}
                  />
                </div>
              </>
            ) : form.billing_model === "per_service" ? (
              <div className="col-span-4 space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] font-medium">Serviços vinculados ao contrato</Label>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-muted-foreground">
                      Valor mensal:{" "}
                      <span className="font-medium text-foreground">
                        R$ {computedMonthly.toFixed(2)}
                      </span>
                    </span>
                    {!readOnly && (
                      <Button type="button" size="sm" variant="outline" onClick={addService}>
                        <Plus className="h-3 w-3 mr-1" /> Adicionar serviços
                      </Button>
                    )}
                  </div>
                </div>
                {form.service_items.length === 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    Nenhum serviço adicionado.
                  </div>
                )}
                {form.service_items.map((s, i) => (
                  <div key={i} className="grid grid-cols-[1fr_2fr_0.8fr_1fr_auto] gap-2 items-end">
                    <div>
                      <Label>Referência</Label>
                      <Input
                        value={s.reference}
                        onChange={(e) => updateService(i, { reference: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Descrição</Label>
                      <Input
                        value={s.description}
                        onChange={(e) => updateService(i, { description: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Quantidade</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={s.quantity}
                        onChange={(e) => updateService(i, { quantity: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <Label>Valor unitário (R$)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={s.price}
                        onChange={(e) => updateService(i, { price: Number(e.target.value) })}
                      />
                    </div>
                    {!readOnly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeService(i)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="col-span-4 space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] font-medium">
                    Faixas por quantidade de equipamentos
                  </Label>
                  {!readOnly && (
                    <Button type="button" size="sm" variant="outline" onClick={addTier}>
                      <Plus className="h-3 w-3 mr-1" /> Adicionar faixa
                    </Button>
                  )}
                </div>
                {form.equipment_tiers.length === 0 && (
                  <div className="text-[11px] text-muted-foreground">Nenhuma faixa cadastrada.</div>
                )}
                {form.equipment_tiers.map((t, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                    <div>
                      <Label>De</Label>
                      <Input
                        type="number"
                        min={0}
                        value={t.min}
                        onChange={(e) => updateTier(i, { min: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <Label>Até</Label>
                      <Input
                        type="number"
                        min={0}
                        value={t.max}
                        onChange={(e) => updateTier(i, { max: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <Label>Valor (R$)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={t.price}
                        onChange={(e) => updateTier(i, { price: Number(e.target.value) })}
                      />
                    </div>
                    {!readOnly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTier(i)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {form.billing_model === "per_equipment" && (
              <div className="col-span-4 space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] font-medium">
                    Equipamentos vinculados ao contrato
                    {form.company_id ? "" : " (selecione um cliente primeiro)"}
                  </Label>
                  <div className="text-[11px] text-muted-foreground">
                    {selectedEquipIds.length} selecionado(s) · Valor mensal:{" "}
                    <span className="font-medium text-foreground">
                      R$ {computedMonthly.toFixed(2)}
                    </span>
                  </div>
                </div>
                {!form.company_id ? null : !companyEquipments?.length ? (
                  <div className="text-[11px] text-muted-foreground">
                    Nenhum equipamento cadastrado para este cliente.
                  </div>
                ) : (
                  <div className="max-h-56 overflow-y-auto border rounded-md divide-y">
                    {companyEquipments.map((eq: any) => {
                      const checked = selectedEquipIds.includes(eq.id);
                      return (
                        <label
                          key={eq.id}
                          className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/40 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            disabled={readOnly}
                            checked={checked}
                            onChange={(e) => {
                              setSelectedEquipIds((prev) =>
                                e.target.checked
                                  ? [...prev, eq.id]
                                  : prev.filter((id) => id !== eq.id),
                              );
                            }}
                          />
                          <div className="flex-1">
                            <div className="text-[12px] font-medium">{eq.name}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {[eq.type, eq.brand, eq.model, eq.serial_number]
                                .filter(Boolean)
                                .join(" · ") || "-"}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
                {selectedEquipIds.length > 0 &&
                  !form.equipment_tiers.some(
                    (t) => selectedEquipIds.length >= t.min && selectedEquipIds.length <= t.max,
                  ) && (
                    <div className="text-[11px] text-destructive">
                      A quantidade selecionada ({selectedEquipIds.length}) não se enquadra em
                      nenhuma faixa cadastrada.
                    </div>
                  )}
              </div>
            )}

            <div className="col-span-4 grid grid-cols-3 gap-2">
              <label className="flex items-center justify-between rounded-md border px-3 py-2">
                <span>Suporte remoto</span>
                <Switch
                  checked={form.includes_remote}
                  onCheckedChange={(v) => setForm({ ...form, includes_remote: v })}
                />
              </label>
              <label className="flex items-center justify-between rounded-md border px-3 py-2">
                <span>Laboratório</span>
                <Switch
                  checked={form.includes_lab}
                  onCheckedChange={(v) => setForm({ ...form, includes_lab: v })}
                />
              </label>
              <label className="flex items-center justify-between rounded-md border px-3 py-2">
                <span>Visita técnica</span>
                <Switch
                  checked={form.includes_onsite}
                  onCheckedChange={(v) => setForm({ ...form, includes_onsite: v })}
                />
              </label>
            </div>

            <div className="col-span-4">
              <Label>Descrição do contrato</Label>
              <Textarea
                rows={3}
                placeholder="Resumo exibido ao abrir tickets (sistema e portal). Ex.: escopo atendido, janelas, exclusões."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="col-span-4">
              <Label>Observações</Label>
              <RichTextEditor
                value={form.notes}
                onChange={(html) => setForm({ ...form, notes: html })}
              />
            </div>
            <DialogFooter className="col-span-4">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {readOnly ? "Fechar" : "Cancelar"}
              </Button>
              {!readOnly && (
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Salvando…" : "Salvar"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </ReadOnlyProvider>
    </Dialog>
  );
}
