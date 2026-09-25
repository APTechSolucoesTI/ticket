import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Bot, Pencil, Plus, Zap } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { getMyTenantId } from "@/lib/tenant";
import { getUserFacingError, getValidationErrorMessage } from "@/lib/user-facing-error";
import { useCurrentModulePermissions } from "@/lib/permission-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Trigger = { id: string; name: string; when_description: string };
type Channel = { id: string; name: string; active: boolean };
type Template = { id: string; title: string; body: string };
type Automation = {
  id: string;
  name: string;
  trigger_id: string;
  outbound_channel_id: string;
  recipient_profile: "financeiro" | "administrativo" | "administrativo_financeiro";
  template_id: string;
  active: boolean;
  automation_triggers?: Trigger | null;
  outbound_channels?: Channel | null;
  canned_responses?: Template | null;
};

const automationSchema = z.object({
  name: z.string().trim().min(3, "Informe um nome").max(160),
  trigger_id: z.string().min(1, "Selecione a função"),
  outbound_channel_id: z.string().uuid("Configure um canal de saída"),
  recipient_profile: z.enum(["financeiro", "administrativo", "administrativo_financeiro"]),
  template_id: z.string().uuid("Selecione um template"),
  active: z.boolean(),
});
type Form = z.infer<typeof automationSchema>;

const emptyForm: Form = {
  name: "Notificação financeira de documentos disponibilizados",
  trigger_id: "documentos_disponibilizados",
  outbound_channel_id: "",
  recipient_profile: "administrativo_financeiro",
  template_id: "",
  active: false,
};

const db = supabase as unknown as SupabaseClient;

export function AutomationsTab() {
  const access = useCurrentModulePermissions();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Automation | null>(null);
  const [open, setOpen] = useState(false);

  const automations = useQuery({
    queryKey: ["automations"],
    queryFn: async () => {
      const { data, error } = await db
        .from("automations")
        .select(
          "*,automation_triggers(id,name,when_description),outbound_channels(id,name,active),canned_responses(id,title,body)",
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Automation[];
    },
  });

  const toggle = useMutation({
    mutationFn: async (automation: Automation) => {
      if (!access.edit) throw new Error("Sem permissão para editar automações.");
      const { error } = await db
        .from("automations")
        .update({ active: !automation.active })
        .eq("id", automation.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Status da automação atualizado.");
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível atualizar.")),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Bot className="h-5 w-5 text-primary" /> Motor de automações
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Conecte eventos do APTicket a ações automáticas e auditáveis.
          </p>
        </div>
        {access.create ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Nova automação
          </Button>
        ) : null}
      </div>

      <Card className="overflow-hidden p-0">
        {automations.isLoading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Carregando automações…
          </div>
        ) : automations.isError ? (
          <div className="p-10 text-center text-sm text-destructive">
            Não foi possível carregar as automações.
          </div>
        ) : !automations.data?.length ? (
          <div className="p-10 text-center">
            <Zap className="mx-auto h-9 w-9 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Nenhuma automação cadastrada</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Configure o canal Financeiro e crie sua primeira regra.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Automação</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {automations.data.map((automation) => (
                <TableRow key={automation.id}>
                  <TableCell>
                    <p className="font-medium">{automation.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {recipientLabel(automation.recipient_profile)}
                    </p>
                  </TableCell>
                  <TableCell>
                    {automation.automation_triggers?.name ?? automation.trigger_id}
                  </TableCell>
                  <TableCell>
                    {automation.outbound_channels?.name ?? "Canal indisponível"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={automation.active}
                        disabled={!access.edit || toggle.isPending}
                        onCheckedChange={() => toggle.mutate(automation)}
                        aria-label={`Ativar ${automation.name}`}
                      />
                      <Badge variant={automation.active ? "default" : "secondary"}>
                        {automation.active ? "Ativa" : "Inativa"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Editar ${automation.name}`}
                      onClick={() => {
                        setEditing(automation);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <AutomationDialog
        open={open}
        automation={editing}
        readOnly={editing ? !access.edit : !access.create}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

function AutomationDialog({
  open,
  automation,
  readOnly,
  onClose,
}: {
  open: boolean;
  automation: Automation | null;
  readOnly: boolean;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(emptyForm);
  useEffect(() => {
    setForm(
      automation
        ? {
            name: automation.name,
            trigger_id: automation.trigger_id,
            outbound_channel_id: automation.outbound_channel_id,
            recipient_profile: automation.recipient_profile,
            template_id: automation.template_id,
            active: automation.active,
          }
        : emptyForm,
    );
  }, [automation, open]);

  const catalogs = useQuery({
    queryKey: ["automation-catalogs"],
    enabled: open,
    queryFn: async () => {
      const [triggers, channels, templates] = await Promise.all([
        db
          .from("automation_triggers")
          .select("id,name,when_description")
          .eq("active", true)
          .is("deleted_at", null),
        db.from("outbound_channels").select("id,name,active").is("deleted_at", null).order("name"),
        db.from("canned_responses").select("id,title,body").order("title"),
      ]);
      const error = triggers.error ?? channels.error ?? templates.error;
      if (error) throw error;
      return {
        triggers: (triggers.data ?? []) as Trigger[],
        channels: (channels.data ?? []) as Channel[],
        templates: (templates.data ?? []) as Template[],
      };
    },
  });

  useEffect(() => {
    if (automation || !catalogs.data) return;
    const financial =
      catalogs.data.channels.find((item) => item.name.toLowerCase() === "financeiro") ??
      catalogs.data.channels[0];
    const template = catalogs.data.templates.find(
      (item) => item.title.toLowerCase() === "documentos disponibilizados",
    );
    setForm((current) => ({
      ...current,
      outbound_channel_id: financial?.id ?? "",
      template_id: template?.id ?? "",
    }));
  }, [automation, catalogs.data]);

  const selectedTrigger = useMemo(
    () => catalogs.data?.triggers.find((item) => item.id === form.trigger_id),
    [catalogs.data, form.trigger_id],
  );
  const save = useMutation({
    mutationFn: async () => {
      if (readOnly) throw new Error("Sem permissão para salvar automações.");
      const parsed = automationSchema.safeParse(form);
      if (!parsed.success) throw new Error(getValidationErrorMessage(parsed.error));
      const payload = { ...parsed.data, tenant_id: await getMyTenantId() };
      const query = automation
        ? db.from("automations").update(payload).eq("id", automation.id)
        : db.from("automations").insert(payload);
      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(automation ? "Automação atualizada." : "Automação criada.");
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
      onClose();
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível salvar a automação.")),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{automation ? "Editar automação" : "Nova automação"}</DialogTitle>
          <DialogDescription>
            Defina a regra seguindo a ordem função, momento e ação.
          </DialogDescription>
        </DialogHeader>
        {catalogs.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Carregando opções…</div>
        ) : (
          <div className="space-y-5">
            <section className="space-y-3 rounded-xl border p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  1
                </span>
                <h3 className="font-medium">Função</h3>
              </div>
              <div className="space-y-2">
                <Label>Nome da automação</Label>
                <Input
                  value={form.name}
                  disabled={readOnly}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Evento do sistema</Label>
                <Select
                  value={form.trigger_id}
                  disabled={readOnly}
                  onValueChange={(value) => setForm({ ...form, trigger_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogs.data?.triggers.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>
            <section className="space-y-3 rounded-xl border p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  2
                </span>
                <h3 className="font-medium">Quando</h3>
              </div>
              <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                {selectedTrigger?.when_description ??
                  "Selecione uma função para ver o momento do disparo."}
              </p>
            </section>
            <section className="space-y-4 rounded-xl border p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  3
                </span>
                <h3 className="font-medium">O que deve ser feito</h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Canal de saída</Label>
                  <Select
                    value={form.outbound_channel_id}
                    disabled={readOnly}
                    onValueChange={(value) => setForm({ ...form, outbound_channel_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Configure o canal Financeiro" />
                    </SelectTrigger>
                    <SelectContent>
                      {catalogs.data?.channels.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                          {!item.active ? " (inativo)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Destinatários</Label>
                  <Select
                    value={form.recipient_profile}
                    disabled={readOnly}
                    onValueChange={(value) =>
                      setForm({ ...form, recipient_profile: value as Form["recipient_profile"] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="administrativo_financeiro">
                        Administrativo ou Financeiro
                      </SelectItem>
                      <SelectItem value="financeiro">Financeiro</SelectItem>
                      <SelectItem value="administrativo">Administrativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Template de mensagem</Label>
                <Select
                  value={form.template_id}
                  disabled={readOnly}
                  onValueChange={(value) => setForm({ ...form, template_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um template" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogs.data?.templates.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Variáveis: {"{{contato}}"}, {"{{cliente}}"}, {"{{competencia}}"},{" "}
                  {"{{portal_link}}"}.
                </p>
              </div>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Ativar automação</p>
                  <p className="text-xs text-muted-foreground">
                    Começa a executar nos próximos envios.
                  </p>
                </div>
                <Switch
                  checked={form.active}
                  disabled={readOnly}
                  onCheckedChange={(active) => setForm({ ...form, active })}
                />
              </div>
            </section>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          {!readOnly ? (
            <Button disabled={save.isPending || catalogs.isLoading} onClick={() => save.mutate()}>
              {save.isPending ? "Salvando…" : "Salvar automação"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function recipientLabel(profile: Automation["recipient_profile"]) {
  if (profile === "financeiro") return "Contatos financeiros";
  if (profile === "administrativo") return "Contatos administrativos";
  return "Contatos administrativos ou financeiros";
}
