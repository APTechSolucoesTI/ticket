import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, RefreshCw, UserRoundCog, UserX } from "lucide-react";
import { toast } from "sonner";
import { portalFetch } from "@/lib/portal-client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

type PortalContact = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  job_title: string | null;
  can_open_tickets: boolean;
  receives_csat: boolean;
  is_portal_admin: boolean;
  is_portal_financial: boolean;
  is_active: boolean;
};
type ContactForm = Omit<PortalContact, "id">;
const emptyForm: ContactForm = {
  name: "",
  email: "",
  phone: null,
  job_title: null,
  can_open_tickets: true,
  receives_csat: true,
  is_portal_admin: false,
  is_portal_financial: false,
  is_active: true,
};

export function PortalContactManagement({
  currentContactId,
  reloadSession,
}: {
  currentContactId: string;
  reloadSession(): void;
}) {
  const [contacts, setContacts] = useState<PortalContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<PortalContact | "new" | null>(null);
  const [deactivating, setDeactivating] = useState<PortalContact | null>(null);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await portalFetch("/api/public/portal/contacts");
      if (!response.ok) throw new Error();
      const result = await response.json();
      setContacts(result.contacts ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const updateStatus = async (contact: PortalContact, active: boolean) => {
    try {
      const response = await portalFetch("/api/public/portal/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...contact, is_active: active }),
      });
      if (!response.ok) throw new Error();
      toast.success(active ? "Contato reativado." : "Contato inativado.");
      setDeactivating(null);
      await load();
    } catch {
      toast.error("Não foi possível alterar o status do contato.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <UserRoundCog className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Contatos da empresa</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Gerencie quem pode abrir chamados, administrar contatos e acessar documentos
            financeiros.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="mr-2 h-4 w-4" /> Novo contato
          </Button>
        </div>
      </div>
      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando contatos…
        </Card>
      ) : error ? (
        <Card className="border-destructive/30 p-8 text-center text-sm text-destructive">
          Não foi possível carregar os contatos.
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="divide-y">
            {contacts.map((contact) => (
              <article
                key={contact.id}
                className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center ${!contact.is_active ? "bg-muted/35 opacity-70" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{contact.name}</p>
                    {contact.id === currentContactId ? <Badge variant="outline">Você</Badge> : null}
                    {!contact.is_active ? <Badge variant="outline">Inativo</Badge> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {contact.email}
                    {contact.job_title ? ` · ${contact.job_title}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {contact.can_open_tickets ? <Badge variant="secondary">Chamados</Badge> : null}
                    {contact.is_portal_admin ? (
                      <Badge variant="secondary">Administrador</Badge>
                    ) : null}
                    {contact.is_portal_financial ? (
                      <Badge variant="secondary">Financeiro</Badge>
                    ) : null}
                  </div>
                </div>
                <div className="flex gap-1 self-end sm:self-auto">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Editar ${contact.name}`}
                    onClick={() => setEditing(contact)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {contact.is_active ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={contact.id === currentContactId}
                      aria-label={`Inativar ${contact.name}`}
                      onClick={() => setDeactivating(contact)}
                    >
                      <UserX className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void updateStatus(contact, true)}
                    >
                      Reativar
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </Card>
      )}
      <ContactDialog
        contact={editing}
        onClose={() => setEditing(null)}
        onSaved={async (selfChanged) => {
          setEditing(null);
          await load();
          if (selfChanged) reloadSession();
        }}
        currentContactId={currentContactId}
      />
      <AlertDialog
        open={Boolean(deactivating)}
        onOpenChange={(open) => !open && setDeactivating(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Inativar contato?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivating?.name} perderá o acesso ao portal, mas seu histórico de tickets será
              preservado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deactivating && void updateStatus(deactivating, false)}
            >
              Inativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ContactDialog({
  contact,
  currentContactId,
  onClose,
  onSaved,
}: {
  contact: PortalContact | "new" | null;
  currentContactId: string;
  onClose(): void;
  onSaved(selfChanged: boolean): void;
}) {
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (contact === "new") setForm(emptyForm);
    else if (contact) {
      const { id: _id, ...values } = contact;
      setForm(values);
    }
  }, [contact]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    setSaving(true);
    try {
      const creating = contact === "new";
      const response = await portalFetch("/api/public/portal/contacts", {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creating ? form : { ...form, id: (contact as PortalContact).id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          result.error === "email_exists"
            ? "Já existe um contato com este e-mail."
            : "Não foi possível salvar o contato.",
        );
      toast.success(
        creating
          ? result.invited
            ? "Contato criado e convite enviado."
            : "Contato criado, mas o convite não pôde ser enviado."
          : "Contato atualizado.",
      );
      onSaved(!creating && (contact as PortalContact).id === currentContactId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o contato.");
    } finally {
      setSaving(false);
    }
  };
  const toggle = (key: keyof ContactForm, checked: boolean) =>
    setForm((current) => ({ ...current, [key]: checked }));
  return (
    <Dialog open={contact !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{contact === "new" ? "Novo contato" : "Editar contato"}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={save}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>E-mail *</Label>
              <Input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Cargo</Label>
              <Input
                value={form.job_title ?? ""}
                onChange={(e) => setForm({ ...form, job_title: e.target.value || null })}
              />
            </div>
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input
                value={form.phone ?? ""}
                onChange={(e) => setForm({ ...form, phone: e.target.value || null })}
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <PermissionToggle
              label="Pode abrir chamados"
              checked={form.can_open_tickets}
              onChange={(value) => toggle("can_open_tickets", value)}
            />
            <PermissionToggle
              label="Recebe pesquisa CSAT"
              checked={form.receives_csat}
              onChange={(value) => toggle("receives_csat", value)}
            />
            <PermissionToggle
              label="Administrador do portal"
              checked={form.is_portal_admin}
              onChange={(value) => toggle("is_portal_admin", value)}
              disabled={contact !== "new" && contact?.id === currentContactId}
            />
            <PermissionToggle
              label="Acesso financeiro"
              checked={form.is_portal_financial}
              onChange={(value) => toggle("is_portal_financial", value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PermissionToggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-3">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
