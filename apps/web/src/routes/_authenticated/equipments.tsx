import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Monitor, Upload, Eye } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { EquipmentImportDialog } from "@/components/equipment-import-dialog";
import { ConfigurableTable, type ListColumn } from "@/components/configurable-table";
import { ReadOnlyNotice, ReadOnlyProvider, useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/equipments")({
  head: () => ({ meta: [{ title: "Equipamentos — APTicket" }] }),
  component: EquipmentsPage,
});

const NONE = "__none__";

type Equipment = {
  id: string;
  company_id: string;
  contact_id: string | null;
  name: string;
  type: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  asset_tag: string | null;
  operating_system: string | null;
  processor: string | null;
  memory: string | null;
  storage: string | null;
  location: string | null;
  status: string;
  notes: string | null;
  purchase_date: string | null;
  warranty_until: string | null;
  os_key: string | null;
  office_key: string | null;
  companies?: { name: string } | null;
  contacts?: { name: string } | null;
};

const schema = z.object({
  company_id: z.string().uuid("Selecione um cliente"),
  contact_id: z.string().uuid().nullable(),
  name: z.string().trim().min(1, "Nome obrigatório").max(150),
  type: z.string().trim().max(60).optional().or(z.literal("")),
  brand: z.string().trim().max(80).optional().or(z.literal("")),
  model: z.string().trim().max(120).optional().or(z.literal("")),
  serial_number: z.string().trim().max(120).optional().or(z.literal("")),
  asset_tag: z.string().trim().max(80).optional().or(z.literal("")),
  operating_system: z.string().trim().max(120).optional().or(z.literal("")),
  processor: z.string().trim().max(120).optional().or(z.literal("")),
  memory: z.string().trim().max(60).optional().or(z.literal("")),
  storage: z.string().trim().max(120).optional().or(z.literal("")),
  location: z.string().trim().max(150).optional().or(z.literal("")),
  status: z.enum(["active", "maintenance", "retired"]),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  purchase_date: z.string().optional().or(z.literal("")),
  warranty_until: z.string().optional().or(z.literal("")),
  os_key: z.string().trim().max(120).optional().or(z.literal("")),
  office_key: z.string().trim().max(120).optional().or(z.literal("")),
});

const DEFAULT_COLUMNS = ["name", "company", "contact", "serial", "status"];

const COLUMNS: ListColumn<Equipment>[] = [
  {
    key: "name",
    label: "Equipamento",
    className: "font-medium",
    accessor: (e) => e.name,
    cell: (e) => (
      <div className="flex items-center gap-2">
        <Monitor className="h-4 w-4 text-muted-foreground" />
        <div>
          <div>{e.name}</div>
          <div className="text-xs text-muted-foreground">
            {[e.type, e.brand, e.model].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
      </div>
    ),
  },
  {
    key: "company",
    label: "Cliente",
    className: "text-sm",
    accessor: (e) => e.companies?.name ?? "",
    cell: (e) => e.companies?.name || "—",
  },
  {
    key: "contact",
    label: "Contato",
    className: "text-sm",
    accessor: (e) => e.contacts?.name ?? "",
    cell: (e) => e.contacts?.name || "—",
  },
  {
    key: "serial",
    label: "Série / Patrimônio",
    className: "text-sm",
    accessor: (e) => `${e.serial_number ?? ""} ${e.asset_tag ?? ""}`,
    cell: (e) => (
      <>
        {e.serial_number || "—"}
        {e.asset_tag && <div className="text-xs text-muted-foreground">#{e.asset_tag}</div>}
      </>
    ),
  },
  {
    key: "asset_tag",
    label: "Patrimônio",
    className: "text-sm",
    accessor: (e) => e.asset_tag ?? "",
    cell: (e) => e.asset_tag || "—",
  },
  {
    key: "type",
    label: "Tipo",
    className: "text-sm",
    accessor: (e) => e.type ?? "",
    cell: (e) => e.type || "—",
  },
  {
    key: "brand",
    label: "Marca",
    className: "text-sm",
    accessor: (e) => e.brand ?? "",
    cell: (e) => e.brand || "—",
  },
  {
    key: "model",
    label: "Modelo",
    className: "text-sm",
    accessor: (e) => e.model ?? "",
    cell: (e) => e.model || "—",
  },
  {
    key: "operating_system",
    label: "Sistema operacional",
    className: "text-sm",
    accessor: (e) => e.operating_system ?? "",
    cell: (e) => e.operating_system || "—",
  },
  {
    key: "processor",
    label: "Processador",
    className: "text-sm",
    accessor: (e) => e.processor ?? "",
    cell: (e) => e.processor || "—",
  },
  {
    key: "memory",
    label: "Memória",
    className: "text-sm",
    accessor: (e) => e.memory ?? "",
    cell: (e) => e.memory || "—",
  },
  {
    key: "storage",
    label: "Armazenamento",
    className: "text-sm",
    accessor: (e) => e.storage ?? "",
    cell: (e) => e.storage || "—",
  },
  {
    key: "location",
    label: "Localização",
    className: "text-sm",
    accessor: (e) => e.location ?? "",
    cell: (e) => e.location || "—",
  },
  {
    key: "purchase_date",
    label: "Aquisição",
    className: "text-sm",
    accessor: (e) => e.purchase_date ?? "",
    cell: (e) => e.purchase_date || "—",
  },
  {
    key: "warranty_until",
    label: "Garantia",
    className: "text-sm",
    accessor: (e) => e.warranty_until ?? "",
    cell: (e) => e.warranty_until || "—",
  },
  {
    key: "status",
    label: "Status",
    accessor: (e) => e.status,
    cell: (e) => (
      <Badge variant={e.status === "active" ? "secondary" : "outline"}>
        {e.status === "active" ? "Ativo" : e.status === "maintenance" ? "Manutenção" : "Baixado"}
      </Badge>
    ),
  },
];

function EquipmentsPage() {
  const access = useModulePermissions("equipamentos");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [toDelete, setToDelete] = useState<Equipment | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["equipments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipments")
        .select("*, companies(name), contacts(name)")
        .order("name");
      if (error) throw error;
      return data as Equipment[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("equipments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Equipamento removido");
      qc.invalidateQueries({ queryKey: ["equipments"] });
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Equipamentos"
        subtitle="Ativos vinculados a clientes e contatos, rastreados nos atendimentos."
        actions={
          access.create ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4 mr-1" /> Importar
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1" /> Novo equipamento
              </Button>
            </div>
          ) : undefined
        }
      />

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando…</Card>
      ) : !data?.length ? (
        <EmptyStub
          title="Nenhum equipamento cadastrado"
          message="Cadastre os ativos dos clientes para vincular aos tickets."
        />
      ) : (
        <Card className="p-3">
          <ConfigurableTable<Equipment>
            listKey="equipments"
            rows={data}
            rowKey={(e) => e.id}
            defaultColumns={DEFAULT_COLUMNS}
            columns={COLUMNS}
            rowActions={(e) => (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditing(e);
                    setOpen(true);
                  }}
                >
                  {access.edit ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                {access.delete && (
                  <Button variant="ghost" size="icon" onClick={() => setToDelete(e)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          />
        </Card>
      )}

      <EquipmentDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        readOnly={editing ? !access.edit : !access.create}
      />
      {access.create && <EquipmentImportDialog open={importOpen} onOpenChange={setImportOpen} />}

      {access.delete && (
        <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover equipamento?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação removerá <b>{toDelete?.name}</b>. Tickets vinculados manterão o histórico
                mas perderão a referência.
              </AlertDialogDescription>
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

function EquipmentDialog({
  open,
  onOpenChange,
  editing,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Equipment | null;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    company_id: "",
    contact_id: "",
    name: "",
    type: "",
    brand: "",
    model: "",
    serial_number: "",
    asset_tag: "",
    operating_system: "",
    processor: "",
    memory: "",
    storage: "",
    location: "",
    status: "active" as "active" | "maintenance" | "retired",
    notes: "",
    purchase_date: "",
    warranty_until: "",
    os_key: "",
    office_key: "",
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      company_id: editing?.company_id ?? "",
      contact_id: editing?.contact_id ?? "",
      name: editing?.name ?? "",
      type: editing?.type ?? "",
      brand: editing?.brand ?? "",
      model: editing?.model ?? "",
      serial_number: editing?.serial_number ?? "",
      asset_tag: editing?.asset_tag ?? "",
      operating_system: editing?.operating_system ?? "",
      processor: editing?.processor ?? "",
      memory: editing?.memory ?? "",
      storage: editing?.storage ?? "",
      location: editing?.location ?? "",
      status: (editing?.status as "active" | "maintenance" | "retired") ?? "active",
      notes: editing?.notes ?? "",
      purchase_date: editing?.purchase_date ?? "",
      warranty_until: editing?.warranty_until ?? "",
      os_key: editing?.os_key ?? "",
      office_key: editing?.office_key ?? "",
    });
  }, [open, editing]);

  const { data: companies } = useQuery({
    queryKey: ["companies", "options"],
    queryFn: async () =>
      (await supabase.from("companies").select("id, name").order("name")).data ?? [],
  });
  const { data: contacts } = useQuery({
    queryKey: ["contacts", "options", form.company_id],
    enabled: !!form.company_id,
    queryFn: async () =>
      (
        await supabase
          .from("contacts")
          .select("id, name")
          .eq("company_id", form.company_id)
          .order("name")
      ).data ?? [],
  });

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof schema>) => {
      const _tid = await getMyTenantId();
      if (!_tid) throw new Error("Tenant não encontrado");
      const prof = { tenant_id: _tid };
      if (!prof?.tenant_id) throw new Error("Tenant não encontrado");
      const values = {
        company_id: payload.company_id,
        contact_id: payload.contact_id,
        name: payload.name,
        type: payload.type || null,
        brand: payload.brand || null,
        model: payload.model || null,
        serial_number: payload.serial_number || null,
        asset_tag: payload.asset_tag || null,
        operating_system: payload.operating_system || null,
        processor: payload.processor || null,
        memory: payload.memory || null,
        storage: payload.storage || null,
        location: payload.location || null,
        status: payload.status,
        notes: payload.notes || null,
        purchase_date: payload.purchase_date || null,
        warranty_until: payload.warranty_until || null,
        os_key: payload.os_key || null,
        office_key: payload.office_key || null,
      };

      if (payload.asset_tag) {
        const normalized = payload.asset_tag.trim().toUpperCase();
        const { data: existing, error: checkErr } = await supabase
          .from("equipments")
          .select("id, asset_tag")
          .not("asset_tag", "is", null);
        if (checkErr) throw checkErr;
        const dup = existing?.find(
          (e) => e.id !== editing?.id && (e.asset_tag ?? "").trim().toUpperCase() === normalized,
        );
        if (dup) throw new Error("Já existe um equipamento cadastrado com este patrimônio.");
      }

      if (editing) {
        const { error } = await supabase.from("equipments").update(values).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("equipments")
          .insert({ ...values, tenant_id: prof.tenant_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Equipamento atualizado" : "Equipamento criado");
      qc.invalidateQueries({ queryKey: ["equipments"] });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("equipments_tenant_asset_tag_uidx")
          ? "Já existe um equipamento cadastrado com este patrimônio."
          : e.message,
      ),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ReadOnlyProvider readOnly={readOnly}>
        <DialogContent className="max-w-5xl w-[98vw] max-h-[95vh] overflow-y-auto p-4 text-xs [&_label]:text-xs [&_input]:h-8 [&_input]:text-xs [&_button[role=combobox]]:h-8 [&_button[role=combobox]]:text-xs">
          <DialogHeader className="pb-1">
            <DialogTitle className="text-sm">
              {readOnly
                ? "Visualizar equipamento"
                : editing
                  ? "Editar equipamento"
                  : "Novo equipamento"}
            </DialogTitle>
          </DialogHeader>
          <ReadOnlyNotice show={readOnly} />
          <form
            className="grid grid-cols-4 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (readOnly) return;
              const r = schema.safeParse({ ...form, contact_id: form.contact_id || null });
              if (!r.success) {
                toast.error(r.error.issues[0].message);
                return;
              }
              save.mutate(r.data);
            }}
          >
            <div className="col-span-2">
              <Label>Cliente *</Label>
              <Select
                value={form.company_id}
                onValueChange={(v) => setForm({ ...form, company_id: v, contact_id: "" })}
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
            <div className="col-span-2">
              <Label>Contato responsável</Label>
              <Select
                value={form.contact_id || NONE}
                onValueChange={(v) => setForm({ ...form, contact_id: v === NONE ? "" : v })}
                disabled={!form.company_id}
              >
                <SelectTrigger>
                  <SelectValue placeholder={form.company_id ? "Nenhum" : "Selecione o cliente"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhum</SelectItem>
                  {contacts?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Linha 2 */}
            <div>
              <Label>Nome / Identificação *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex: Notebook Diretoria"
              />
            </div>
            <div>
              <Label>Patrimônio</Label>
              <Input
                value={form.asset_tag}
                onChange={(e) => setForm({ ...form, asset_tag: e.target.value })}
              />
            </div>
            <div>
              <Label>Número de série</Label>
              <Input
                value={form.serial_number}
                onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as typeof form.status })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="maintenance">Manutenção</SelectItem>
                  <SelectItem value="retired">Baixado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Linha 3 */}
            <div>
              <Label>Localização</Label>
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </div>
            <div>
              <Label>Tipo</Label>
              <Input
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                placeholder="Notebook, Desktop…"
              />
            </div>
            <div>
              <Label>Marca</Label>
              <Input
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
              />
            </div>
            <div>
              <Label>Modelo</Label>
              <Input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </div>
            {/* Linha 4 */}
            <div className="col-span-2">
              <Label>Processador</Label>
              <Input
                value={form.processor}
                onChange={(e) => setForm({ ...form, processor: e.target.value })}
                placeholder="Ex: i7-1260P"
              />
            </div>
            <div>
              <Label>Memória</Label>
              <Input
                value={form.memory}
                onChange={(e) => setForm({ ...form, memory: e.target.value })}
                placeholder="Ex: 16 GB"
              />
            </div>
            <div>
              <Label>Armazenamento</Label>
              <Input
                value={form.storage}
                onChange={(e) => setForm({ ...form, storage: e.target.value })}
                placeholder="Ex: SSD 512 GB"
              />
            </div>
            {/* Linha 5 */}
            <div className="col-span-2">
              <Label>Sistema operacional</Label>
              <Input
                value={form.operating_system}
                onChange={(e) => setForm({ ...form, operating_system: e.target.value })}
              />
            </div>
            <div>
              <Label>Data de aquisição</Label>
              <Input
                type="date"
                value={form.purchase_date}
                onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
              />
            </div>
            <div>
              <Label>Garantia até</Label>
              <Input
                type="date"
                value={form.warranty_until}
                onChange={(e) => setForm({ ...form, warranty_until: e.target.value })}
              />
            </div>
            {/* Linha 6 */}
            <div className="col-span-2">
              <Label>Chave do Sistema Operacional</Label>
              <Input
                value={form.os_key}
                onChange={(e) => setForm({ ...form, os_key: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label>Chave do Office</Label>
              <Input
                value={form.office_key}
                onChange={(e) => setForm({ ...form, office_key: e.target.value })}
              />
            </div>
            <div className="col-span-4">
              <Label>Observações</Label>
              <div className="[&_.ProseMirror]:min-h-[80px] [&_.ProseMirror]:max-h-[120px] [&_.ProseMirror]:overflow-y-auto">
                <RichTextEditor
                  value={form.notes}
                  onChange={(html) => setForm({ ...form, notes: html })}
                />
              </div>
            </div>
            <DialogFooter className="col-span-4 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                {readOnly ? "Fechar" : "Cancelar"}
              </Button>
              {!readOnly && (
                <Button type="submit" size="sm" disabled={save.isPending}>
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
