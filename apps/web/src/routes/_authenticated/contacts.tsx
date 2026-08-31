import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, User, Upload, Eye } from "lucide-react";
import { ContactImportDialog } from "@/components/contact-import-dialog";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { getMyTenantId } from "@/lib/tenant";
import { PageHeader, EmptyStub } from "@/components/empty-stub";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { maskPhone, normalizePhone, unmask } from "@/lib/masks";
import { ReadOnlyNotice, ReadOnlyProvider, useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({ meta: [{ title: "Contatos - APTicket" }] }),
  component: ContactsPage,
});

type Contact = {
  id: string;
  company_id: string;
  name: string;
  email: string;
  phone: string | null;
  job_title: string | null;
  can_open_tickets: boolean;
  receives_csat: boolean;
  is_active: boolean;
  companies?: { name: string } | null;
};

const schema = z.object({
  company_id: z.string().uuid("Selecione um cliente"),
  name: z.string().trim().min(1, "Nome obrigatório").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(255),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || unmask(v).length >= 10, "Telefone inválido"),
  job_title: z.string().trim().max(120).optional().or(z.literal("")),
  can_open_tickets: z.boolean(),
  receives_csat: z.boolean(),
  is_active: z.boolean(),
});

function ContactsPage() {
  const access = useModulePermissions("contatos");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [toDelete, setToDelete] = useState<Contact | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("*, companies(name)")
        .order("name");
      if (error) throw error;
      return data as Contact[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contacts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contato removido");
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Contatos"
        subtitle="Pessoas vinculadas aos clientes. E-mail e telefone identificam mensagens recebidas."
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
                <Plus className="h-4 w-4 mr-1" /> Novo contato
              </Button>
            </div>
          ) : undefined
        }
      />

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando…</Card>
      ) : !data?.length ? (
        <EmptyStub
          title="Nenhum contato cadastrado"
          message="Cadastre contatos vinculados a um cliente para receber chamados automaticamente."
        />
      ) : (
        <Card className="p-3">
          <ConfigurableTable<Contact>
            listKey="contacts"
            rows={data}
            rowKey={(c) => c.id}
            defaultColumns={["name", "company", "email", "phone", "flags"]}
            columns={
              [
                {
                  key: "name",
                  label: "Nome",
                  className: "font-medium",
                  cell: (c) => (
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div>{c.name}</div>
                        {c.job_title && (
                          <div className="text-xs text-muted-foreground">{c.job_title}</div>
                        )}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "company",
                  label: "Cliente",
                  className: "text-sm",
                  cell: (c) => c.companies?.name || "-",
                },
                { key: "email", label: "E-mail", className: "text-sm", cell: (c) => c.email },
                {
                  key: "phone",
                  label: "Telefone",
                  className: "text-sm",
                  cell: (c) => (c.phone ? maskPhone(c.phone) : "-"),
                },
                {
                  key: "job_title",
                  label: "Cargo",
                  className: "text-sm",
                  cell: (c) => c.job_title || "-",
                },
                {
                  key: "flags",
                  label: "",
                  cell: (c) => (
                    <div className="space-x-1">
                      {!c.is_active && <Badge variant="outline">Inativo</Badge>}
                      {!c.can_open_tickets && <Badge variant="outline">Sem abertura</Badge>}
                    </div>
                  ),
                },
              ] as ListColumn<Contact>[]
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

      <ContactDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        readOnly={editing ? !access.edit : !access.create}
      />
      {access.create && <ContactImportDialog open={importOpen} onOpenChange={setImportOpen} />}

      {access.delete && (
        <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover contato?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação removerá <b>{toDelete?.name}</b>.
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

function ContactDialog({
  open,
  onOpenChange,
  editing,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Contact | null;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    company_id: "",
    name: "",
    email: "",
    phone: "",
    job_title: "",
    can_open_tickets: true,
    receives_csat: true,
    is_active: true,
  });

  const { data: companies } = useQuery({
    queryKey: ["companies", "options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof schema>) => {
      const _tid = await getMyTenantId();
      if (!_tid) throw new Error("Tenant não encontrado");
      const prof = { tenant_id: _tid };
      if (!prof?.tenant_id) throw new Error("Tenant não encontrado");
      const values = {
        company_id: payload.company_id,
        name: payload.name,
        email: payload.email,
        phone: payload.phone ? normalizePhone(payload.phone) : null,
        job_title: payload.job_title || null,
        can_open_tickets: payload.can_open_tickets,
        receives_csat: payload.receives_csat,
        is_active: payload.is_active,
      };

      if (payload.phone) {
        const digits = normalizePhone(payload.phone);
        const { data: existing, error: checkErr } = await supabase
          .from("contacts")
          .select("id, phone")
          .not("phone", "is", null);
        if (checkErr) throw checkErr;
        const dup = existing?.find(
          (c) => c.id !== editing?.id && normalizePhone(c.phone ?? "") === digits,
        );
        if (dup) throw new Error("Já existe um contato cadastrado com este telefone.");
      }

      if (editing) {
        const { error } = await supabase.from("contacts").update(values).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("contacts")
          .insert({ ...values, tenant_id: prof.tenant_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Contato atualizado" : "Contato criado");
      qc.invalidateQueries({ queryKey: ["contacts"] });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("contacts_tenant_phone_uidx")
          ? "Já existe um contato cadastrado com este telefone."
          : e.message,
      ),
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      company_id: editing?.company_id ?? "",
      name: editing?.name ?? "",
      email: editing?.email ?? "",
      phone: editing?.phone ? maskPhone(editing.phone) : "",
      job_title: editing?.job_title ?? "",
      can_open_tickets: editing?.can_open_tickets ?? true,
      receives_csat: editing?.receives_csat ?? true,
      is_active: editing?.is_active ?? true,
    });
  }, [open, editing]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ReadOnlyProvider readOnly={readOnly}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {readOnly ? "Visualizar contato" : editing ? "Editar contato" : "Novo contato"}
            </DialogTitle>
          </DialogHeader>
          <ReadOnlyNotice show={readOnly} />
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (readOnly) return;
              const r = schema.safeParse(form);
              if (!r.success) {
                toast.error(r.error.issues[0].message);
                return;
              }
              save.mutate(r.data);
            }}
          >
            <div className="sm:col-span-2">
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
              <Label>Nome *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Cargo</Label>
              <Input
                value={form.job_title}
                onChange={(e) => setForm({ ...form, job_title: e.target.value })}
              />
            </div>
            <div>
              <Label>E-mail *</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })}
                placeholder="55 11 99999-9999"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
              <div className="text-sm">Pode abrir tickets</div>
              <Switch
                checked={form.can_open_tickets}
                onCheckedChange={(v) => setForm({ ...form, can_open_tickets: v })}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
              <div className="text-sm">Recebe pesquisa CSAT</div>
              <Switch
                checked={form.receives_csat}
                onCheckedChange={(v) => setForm({ ...form, receives_csat: v })}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
              <div className="text-sm">Ativo</div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
            </div>
            <DialogFooter className="sm:col-span-2">
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
