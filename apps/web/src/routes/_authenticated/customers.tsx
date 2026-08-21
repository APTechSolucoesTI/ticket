import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Building2, Search, Loader2, Eye } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { getMyTenantId } from "@/lib/tenant";
import { PageHeader, EmptyStub } from "@/components/empty-stub";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ConfigurableTable, type ListColumn } from "@/components/configurable-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { maskCNPJ, maskPhone, maskCEP, isValidCNPJ, isValidWebsite, unmask } from "@/lib/masks";
import { ReadOnlyNotice, ReadOnlyProvider, useModulePermissions } from "@/lib/permission-ui";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({ meta: [{ title: "Clientes — APTicket" }] }),
  component: CustomersPage,
});

type Company = {
  id: string;
  name: string;
  fantasy_name: string | null;
  cnpj: string | null;
  segment: string | null;
  phone: string | null;
  website: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  is_vip: boolean;
  notes: string | null;
};

const schema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório").max(150),
  fantasy_name: z.string().trim().max(150).optional().or(z.literal("")),
  cnpj: z
    .string()
    .trim()
    .max(20)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || isValidCNPJ(v), "CNPJ inválido"),
  segment: z.string().trim().max(80).optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || unmask(v).length >= 10, "Telefone inválido"),
  website: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || isValidWebsite(v), "Website inválido"),
  address_zip: z
    .string()
    .trim()
    .max(10)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || unmask(v).length === 8, "CEP inválido"),
  address_street: z.string().trim().max(200).optional().or(z.literal("")),
  address_number: z.string().trim().max(20).optional().or(z.literal("")),
  address_complement: z.string().trim().max(120).optional().or(z.literal("")),
  address_neighborhood: z.string().trim().max(120).optional().or(z.literal("")),
  address_city: z.string().trim().max(100).optional().or(z.literal("")),
  address_state: z.string().trim().max(2).optional().or(z.literal("")),
  is_vip: z.boolean(),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

function CustomersPage() {
  const access = useModulePermissions("clientes");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [toDelete, setToDelete] = useState<Company | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("*").order("name");
      if (error) throw error;
      return data as Company[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("companies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente removido");
      qc.invalidateQueries({ queryKey: ["companies"] });
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Clientes"
        subtitle="Empresas atendidas, contratos e franquia de horas."
        actions={
          access.create ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Novo cliente
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando…</Card>
      ) : !data?.length ? (
        <EmptyStub
          title="Nenhum cliente cadastrado"
          message="Cadastre clientes e vincule contratos ativos para permitir abertura de tickets."
        />
      ) : (
        <Card className="p-3">
          <ConfigurableTable<Company>
            listKey="customers"
            rows={data}
            rowKey={(c) => c.id}
            defaultColumns={["name", "cnpj", "segment", "phone", "vip"]}
            columns={
              [
                {
                  key: "name",
                  label: "Nome",
                  className: "font-medium",
                  cell: (c) => (
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div>{c.name}</div>
                        {c.fantasy_name && (
                          <div className="text-xs text-muted-foreground">{c.fantasy_name}</div>
                        )}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "cnpj",
                  label: "CNPJ",
                  className: "text-sm",
                  cell: (c) => (c.cnpj ? maskCNPJ(c.cnpj) : "—"),
                },
                {
                  key: "segment",
                  label: "Segmento",
                  className: "text-sm",
                  cell: (c) => c.segment || "—",
                },
                {
                  key: "phone",
                  label: "Telefone",
                  className: "text-sm",
                  cell: (c) => (c.phone ? maskPhone(c.phone) : "—"),
                },
                {
                  key: "website",
                  label: "Website",
                  className: "text-sm",
                  cell: (c) => c.website || "—",
                },
                {
                  key: "city",
                  label: "Cidade",
                  className: "text-sm",
                  cell: (c) => c.address_city || "—",
                },
                {
                  key: "state",
                  label: "UF",
                  className: "text-sm",
                  cell: (c) => c.address_state || "—",
                },
                {
                  key: "vip",
                  label: "VIP",
                  cell: (c) => (c.is_vip ? <Badge variant="secondary">VIP</Badge> : null),
                },
              ] as ListColumn<Company>[]
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

      <CompanyDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        readOnly={editing ? !access.edit : !access.create}
      />

      {access.delete && (
        <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover cliente?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação removerá <b>{toDelete?.name}</b> e todos os contatos e contratos
                vinculados.
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

function CompanyDialog({
  open,
  onOpenChange,
  editing,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Company | null;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    fantasy_name: "",
    cnpj: "",
    segment: "",
    phone: "",
    website: "",
    address_zip: "",
    address_street: "",
    address_number: "",
    address_complement: "",
    address_neighborhood: "",
    address_city: "",
    address_state: "",
    is_vip: false,
    notes: "",
  });
  const [lookingUp, setLookingUp] = useState(false);
  const [cepLookup, setCepLookup] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: editing?.name ?? "",
      fantasy_name: editing?.fantasy_name ?? "",
      cnpj: editing?.cnpj ? maskCNPJ(editing.cnpj) : "",
      segment: editing?.segment ?? "",
      phone: editing?.phone ? maskPhone(editing.phone) : "",
      website: editing?.website ?? "",
      address_zip: editing?.address_zip ? maskCEP(editing.address_zip) : "",
      address_street: editing?.address_street ?? "",
      address_number: editing?.address_number ?? "",
      address_complement: editing?.address_complement ?? "",
      address_neighborhood: editing?.address_neighborhood ?? "",
      address_city: editing?.address_city ?? "",
      address_state: editing?.address_state ?? "",
      is_vip: editing?.is_vip ?? false,
      notes: editing?.notes ?? "",
    });
  }, [open, editing]);

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof schema>) => {
      const _tid = await getMyTenantId();
      if (!_tid) throw new Error("Tenant não encontrado");
      const prof = { tenant_id: _tid };
      if (!prof?.tenant_id) throw new Error("Tenant não encontrado");
      const values = {
        name: payload.name,
        fantasy_name: payload.fantasy_name || null,
        cnpj: payload.cnpj || null,
        segment: payload.segment || null,
        phone: payload.phone || null,
        website: payload.website || null,
        address_zip: payload.address_zip || null,
        address_street: payload.address_street || null,
        address_number: payload.address_number || null,
        address_complement: payload.address_complement || null,
        address_neighborhood: payload.address_neighborhood || null,
        address_city: payload.address_city || null,
        address_state: payload.address_state ? payload.address_state.toUpperCase() : null,
        is_vip: payload.is_vip,
        notes: payload.notes || null,
      };

      if (payload.cnpj) {
        const digits = unmask(payload.cnpj);
        const { data: existing, error: checkErr } = await supabase
          .from("companies")
          .select("id, cnpj")
          .not("cnpj", "is", null);
        if (checkErr) throw checkErr;
        const dup = existing?.find((c) => c.id !== editing?.id && unmask(c.cnpj ?? "") === digits);
        if (dup) throw new Error("Já existe um cliente cadastrado com este CNPJ.");
      }

      if (editing) {
        const { error } = await supabase.from("companies").update(values).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("companies")
          .insert({ ...values, tenant_id: prof.tenant_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Cliente atualizado" : "Cliente criado");
      qc.invalidateQueries({ queryKey: ["companies"] });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("companies_tenant_cnpj_uidx")
          ? "Já existe um cliente cadastrado com este CNPJ."
          : e.message,
      ),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ReadOnlyProvider readOnly={readOnly}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw]">
          <DialogHeader>
            <DialogTitle>
              {readOnly ? "Visualizar cliente" : editing ? "Editar cliente" : "Novo cliente"}
            </DialogTitle>
          </DialogHeader>
          <ReadOnlyNotice show={readOnly} />
          <form
            className="space-y-4"
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
            <Tabs defaultValue="dados" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="dados">Dados</TabsTrigger>
                <TabsTrigger value="endereco">Endereço</TabsTrigger>
              </TabsList>
              <TabsContent value="dados" className="grid grid-cols-2 gap-3 mt-4">
                <div className="col-span-2">
                  <Label>Razão social *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Nome fantasia</Label>
                  <Input
                    value={form.fantasy_name}
                    onChange={(e) => setForm({ ...form, fantasy_name: e.target.value })}
                  />
                </div>
                <div>
                  <Label>CNPJ</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.cnpj}
                      onChange={(e) => setForm({ ...form, cnpj: maskCNPJ(e.target.value) })}
                      placeholder="00.000.000/0000-00"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={readOnly || lookingUp}
                      onClick={async () => {
                        const digits = unmask(form.cnpj);
                        if (digits.length !== 14 || !isValidCNPJ(digits)) {
                          toast.error("Informe um CNPJ válido");
                          return;
                        }
                        setLookingUp(true);
                        try {
                          const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
                          if (!res.ok) throw new Error("CNPJ não encontrado");
                          const d = await res.json();
                          setForm((f) => ({
                            ...f,
                            name: d.razao_social || f.name,
                            fantasy_name: d.nome_fantasia || f.fantasy_name,
                            segment: d.cnae_fiscal_descricao || f.segment,
                            phone: d.ddd_telefone_1 ? maskPhone(d.ddd_telefone_1) : f.phone,
                            address_zip: d.cep ? maskCEP(String(d.cep)) : f.address_zip,
                            address_street: d.logradouro || f.address_street,
                            address_number: d.numero ? String(d.numero) : f.address_number,
                            address_neighborhood: d.bairro || f.address_neighborhood,
                            address_complement: d.complemento || f.address_complement,
                            address_city: d.municipio || f.address_city,
                            address_state: d.uf || f.address_state,
                          }));
                          toast.success("Dados preenchidos pela Receita Federal");
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : "Falha ao consultar CNPJ",
                          );
                        } finally {
                          setLookingUp(false);
                        }
                      }}
                    >
                      {lookingUp ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div>
                  <Label>Segmento</Label>
                  <Input
                    value={form.segment}
                    onChange={(e) => setForm({ ...form, segment: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Telefone</Label>
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })}
                    placeholder="(00) 00000-0000"
                  />
                </div>
                <div className="col-span-2">
                  <Label>Website</Label>
                  <Input
                    value={form.website}
                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                  />
                </div>
                <div className="col-span-2 flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">Cliente VIP</div>
                    <div className="text-xs text-muted-foreground">Prioriza tickets na inbox.</div>
                  </div>
                  <Switch
                    checked={form.is_vip}
                    onCheckedChange={(v) => setForm({ ...form, is_vip: v })}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Observações</Label>
                  <Textarea
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
              </TabsContent>
              <TabsContent value="endereco" className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <Label>CEP</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.address_zip}
                      onChange={(e) => setForm({ ...form, address_zip: maskCEP(e.target.value) })}
                      placeholder="00000-000"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={readOnly || cepLookup}
                      onClick={async () => {
                        const digits = unmask(form.address_zip);
                        if (digits.length !== 8) {
                          toast.error("Informe um CEP válido");
                          return;
                        }
                        setCepLookup(true);
                        try {
                          const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`);
                          if (!res.ok) throw new Error("CEP não encontrado");
                          const d = await res.json();
                          setForm((f) => ({
                            ...f,
                            address_street: d.street || f.address_street,
                            address_neighborhood: d.neighborhood || f.address_neighborhood,
                            address_city: d.city || f.address_city,
                            address_state: d.state || f.address_state,
                          }));
                          toast.success("Endereço preenchido pelo CEP");
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : "Falha ao consultar CEP",
                          );
                        } finally {
                          setCepLookup(false);
                        }
                      }}
                    >
                      {cepLookup ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div>
                  <Label>Estado (UF)</Label>
                  <Input
                    maxLength={2}
                    value={form.address_state}
                    onChange={(e) =>
                      setForm({ ...form, address_state: e.target.value.toUpperCase() })
                    }
                    placeholder="SP"
                  />
                </div>
                <div className="col-span-2">
                  <Label>Logradouro</Label>
                  <Input
                    value={form.address_street}
                    onChange={(e) => setForm({ ...form, address_street: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Número</Label>
                  <Input
                    value={form.address_number}
                    onChange={(e) => setForm({ ...form, address_number: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Bairro</Label>
                  <Input
                    value={form.address_neighborhood}
                    onChange={(e) => setForm({ ...form, address_neighborhood: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Complemento</Label>
                  <Input
                    value={form.address_complement}
                    onChange={(e) => setForm({ ...form, address_complement: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Cidade</Label>
                  <Input
                    value={form.address_city}
                    onChange={(e) => setForm({ ...form, address_city: e.target.value })}
                  />
                </div>
              </TabsContent>
            </Tabs>
            <DialogFooter>
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
