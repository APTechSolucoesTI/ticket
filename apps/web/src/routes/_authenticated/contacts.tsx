import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ExternalLink,
  Eye,
  Loader2,
  Pencil,
  Plus,
  Tickets,
  UserX,
  Upload,
  User,
} from "lucide-react";
import { ContactImportDialog } from "@/components/contact-import-dialog";
import { ContactCompanySelect } from "@/components/contact-company-select";
import { ContactSecondaryFields } from "@/components/contact-secondary-fields";
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
import { ConfigurableTable, type ListColumn } from "@/components/configurable-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TicketBadge, type TicketStatus } from "@/components/ticket/TicketBadge";
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
import { getUserFacingError } from "@/lib/user-facing-error";

export const Route = createFileRoute("/_authenticated/contacts")({
  validateSearch: z.object({ record: z.string().optional() }),
  head: () => ({ meta: [{ title: "Contatos - APTicket" }] }),
  component: ContactsPage,
});

type Contact = {
  id: string;
  company_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  secondary_emails: string[];
  secondary_phones: string[];
  job_title: string | null;
  can_open_tickets: boolean;
  receives_csat: boolean;
  is_active: boolean;
  is_portal_admin: boolean;
  is_portal_financial: boolean;
  companies?: { name: string } | null;
  contact_companies?: Array<{ company_id: string; companies?: { name: string } | null }>;
};

type ContactTicket = {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  created_at: string;
};

const schema = z
  .object({
    company_ids: z.array(z.string().uuid()).min(1, "Selecione ao menos um cliente"),
    name: z.string().trim().min(1, "Nome obrigatório").max(120),
    email: z.string().trim().toLowerCase().email("E-mail inválido").max(255),
    secondary_emails: z.array(
      z.string().trim().toLowerCase().email("E-mail secundário inválido").max(255),
    ),
    secondary_phones: z.array(
      z
        .string()
        .trim()
        .min(1, "Informe o telefone ou remova o campo")
        .max(40)
        .refine(
          (v) => unmask(v).length >= 10 && unmask(v).length <= 15,
          "Telefone secundário inválido",
        ),
    ),
    phone: z
      .string()
      .trim()
      .max(40)
      .optional()
      .or(z.literal(""))
      .refine((v) => !v || (unmask(v).length >= 10 && unmask(v).length <= 15), "Telefone inválido"),
    job_title: z.string().trim().max(120).optional().or(z.literal("")),
    can_open_tickets: z.boolean(),
    receives_csat: z.boolean(),
    is_active: z.boolean(),
    is_portal_admin: z.boolean(),
    is_portal_financial: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const emails = new Set([values.email]);
    values.secondary_emails.forEach((email, index) => {
      if (emails.has(email))
        ctx.addIssue({
          code: "custom",
          path: ["secondary_emails", index],
          message: "Este e-mail já foi informado no contato",
        });
      emails.add(email);
    });
    const phones = new Set(values.phone ? [normalizePhone(values.phone)] : []);
    values.secondary_phones.forEach((phone, index) => {
      const normalized = normalizePhone(phone);
      if (phones.has(normalized))
        ctx.addIssue({
          code: "custom",
          path: ["secondary_phones", index],
          message: "Este telefone já foi informado no contato",
        });
      phones.add(normalized);
    });
  });

function ContactsPage() {
  const { record } = Route.useSearch();
  const navigate = Route.useNavigate();
  const access = useModulePermissions("contatos");
  const ticketsAccess = useModulePermissions("tickets");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [toDelete, setToDelete] = useState<Contact | null>(null);
  const [ticketsContact, setTicketsContact] = useState<Contact | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select(
          "*, companies:companies!contacts_company_id_fkey(name), contact_companies(company_id, companies:companies!contact_companies_company_id_fkey(name))",
        )
        .order("name");
      if (error) throw error;
      return data as Contact[];
    },
  });

  useEffect(() => {
    if (!record || !data) return;

    const contact = data.find((item) => item.id === record);
    if (contact) {
      setEditing(contact);
      setOpen(true);
    }

    void navigate({ search: {}, replace: true });
  }, [data, navigate, record]);

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("contacts")
        .update({ is_active: false, can_open_tickets: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contato inativado");
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setToDelete(null);
    },
    onError: (e: Error) =>
      toast.error(getUserFacingError(e, "Não foi possível remover o contato.")),
  });

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Contatos"
        subtitle="Pessoas vinculadas aos clientes. E-mail e telefone identificam mensagens recebidas."
        icon={User}
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
                  accessor: (c) => `${c.name} ${c.job_title ?? ""}`,
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
                  accessor: (c) =>
                    c.contact_companies?.map((link) => link.companies?.name).join(" ") ??
                    c.companies?.name ??
                    "",
                  cell: (c) => {
                    const names = c.contact_companies
                      ?.map((link) => link.companies?.name)
                      .filter(Boolean) as string[] | undefined;
                    return names?.length ? names.join(", ") : c.companies?.name || "-";
                  },
                },
                {
                  key: "email",
                  label: "E-mail",
                  className: "text-sm",
                  accessor: (c) => [c.email, ...(c.secondary_emails ?? [])].join(" "),
                  cell: (c) => (
                    <div>
                      {c.email}
                      {!!c.secondary_emails?.length && (
                        <div
                          className="text-xs text-muted-foreground"
                          title={c.secondary_emails.join(", ")}
                        >
                          +{c.secondary_emails.length} secundário(s)
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: "phone",
                  label: "Telefone",
                  className: "text-sm",
                  accessor: (c) => [c.phone, ...(c.secondary_phones ?? [])].join(" "),
                  cell: (c) => (
                    <div>
                      {c.phone ? maskPhone(c.phone) : "-"}
                      {!!c.secondary_phones?.length && (
                        <div
                          className="text-xs text-muted-foreground"
                          title={c.secondary_phones.map(maskPhone).join(", ")}
                        >
                          +{c.secondary_phones.length} secundário(s)
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: "job_title",
                  label: "Cargo",
                  className: "text-sm",
                  cell: (c) => c.job_title || "-",
                },
                {
                  key: "flags",
                  label: "Situação",
                  accessor: (c) =>
                    `${c.is_active ? "Ativo" : "Inativo"} ${c.can_open_tickets ? "Com abertura" : "Sem abertura"} ${c.is_portal_admin ? "Administrador do portal" : ""} ${c.is_portal_financial ? "Financeiro do portal" : ""}`,
                  cell: (c) => (
                    <div className="flex flex-wrap gap-1">
                      {!c.is_active && <Badge variant="outline">Inativo</Badge>}
                      {!c.can_open_tickets && <Badge variant="outline">Sem abertura</Badge>}
                      {c.is_portal_admin && <Badge variant="secondary">Admin. portal</Badge>}
                      {c.is_portal_financial && <Badge variant="secondary">Financeiro</Badge>}
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
                  aria-label={`Ver tickets abertos por ${c.name}`}
                  title={
                    ticketsAccess.view
                      ? `Ver tickets abertos por ${c.name}`
                      : "Sem permissão para visualizar tickets"
                  }
                  disabled={!ticketsAccess.view}
                  onClick={() => setTicketsContact(c)}
                >
                  <Tickets className="h-4 w-4" />
                </Button>
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
                    <UserX className="h-4 w-4" />
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
      <ContactTicketsDialog
        contact={ticketsContact}
        onOpenChange={(dialogOpen) => !dialogOpen && setTicketsContact(null)}
      />
      {access.create && <ContactImportDialog open={importOpen} onOpenChange={setImportOpen} />}

      {access.delete && (
        <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Inativar contato?</AlertDialogTitle>
              <AlertDialogDescription>
                <b>{toDelete?.name}</b> perderá o acesso, mas seu histórico será preservado.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => toDelete && del.mutate(toDelete.id)}>
                Inativar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function ContactTicketsDialog({
  contact,
  onOpenChange,
}: {
  contact: Contact | null;
  onOpenChange(open: boolean): void;
}) {
  const tickets = useQuery({
    queryKey: ["contact-tickets", contact?.id],
    enabled: Boolean(contact),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tickets")
        .select("id,number,subject,status,created_at")
        .eq("contact_id", contact!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContactTicket[];
    },
  });

  return (
    <Dialog open={Boolean(contact)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tickets abertos por {contact?.name}</DialogTitle>
          <DialogDescription>
            Histórico completo de tickets associados a este contato, do mais recente ao mais antigo.
          </DialogDescription>
        </DialogHeader>

        {tickets.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando tickets…
          </div>
        ) : tickets.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Não foi possível consultar os tickets deste contato.
          </div>
        ) : !tickets.data?.length ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Tickets className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 font-medium">Nenhum ticket encontrado</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Este contato ainda não abriu tickets.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {tickets.data.map((ticket) => (
              <article
                key={ticket.id}
                className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-primary">
                      #{ticket.number}
                    </span>
                    <TicketBadge status={ticket.status} />
                  </div>
                  <p className="mt-1 truncate text-sm font-medium">{ticket.subject}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Aberto em {new Date(ticket.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                <Button asChild size="sm" variant="outline" className="shrink-0">
                  <Link to="/tickets/$id" params={{ id: ticket.id }}>
                    Abrir ticket <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </article>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    company_ids: [] as string[],
    name: "",
    email: "",
    phone: "",
    secondary_emails: [] as string[],
    secondary_phones: [] as string[],
    job_title: "",
    can_open_tickets: true,
    receives_csat: true,
    is_active: true,
    is_portal_admin: false,
    is_portal_financial: false,
  });

  const companiesQuery = useQuery({
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
        company_id: payload.company_ids[0],
        name: payload.name,
        email: payload.email,
        phone: payload.phone ? normalizePhone(payload.phone) : null,
        secondary_emails: payload.secondary_emails,
        secondary_phones: payload.secondary_phones.map(normalizePhone),
        job_title: payload.job_title || null,
        can_open_tickets: payload.can_open_tickets,
        receives_csat: payload.receives_csat,
        is_active: payload.is_active,
        is_portal_admin: payload.is_portal_admin,
        is_portal_financial: payload.is_portal_financial,
      };

      const phones = [values.phone, ...values.secondary_phones].filter(Boolean);
      if (phones.length) {
        const { data: existing, error: checkErr } = await supabase
          .from("contacts")
          .select("id, phone, secondary_phones");
        if (checkErr) throw checkErr;
        const dup = existing?.find(
          (c) =>
            c.id !== editing?.id &&
            [c.phone, ...c.secondary_phones].some(
              (phone) => phone && phones.includes(normalizePhone(phone)),
            ),
        );
        if (dup) throw new Error("Já existe um contato cadastrado com este telefone.");
      }

      let contactId = editing?.id;
      if (editing) {
        const { error } = await supabase.from("contacts").update(values).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("contacts")
          .insert({ ...values, tenant_id: prof.tenant_id })
          .select("id")
          .single();
        if (error) throw error;
        contactId = data.id;
      }
      const db = supabase as unknown as SupabaseClient;
      const { error: companiesError } = await db.rpc("set_contact_companies", {
        p_contact_id: contactId,
        p_company_ids: payload.company_ids,
      });
      if (companiesError) throw companiesError;
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
          : getUserFacingError(e, "Não foi possível salvar o contato."),
      ),
  });

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm({
      company_ids: editing?.company_id
        ? [
            editing.company_id,
            ...(editing.contact_companies ?? [])
              .map((link) => link.company_id)
              .filter((id) => id !== editing.company_id),
          ]
        : [],
      name: editing?.name ?? "",
      email: editing?.email ?? "",
      phone: editing?.phone ? maskPhone(editing.phone) : "",
      secondary_emails: editing?.secondary_emails ?? [],
      secondary_phones: (editing?.secondary_phones ?? []).map(maskPhone),
      job_title: editing?.job_title ?? "",
      can_open_tickets: editing?.can_open_tickets ?? true,
      receives_csat: editing?.receives_csat ?? true,
      is_active: editing?.is_active ?? true,
      is_portal_admin: editing?.is_portal_admin ?? false,
      is_portal_financial: editing?.is_portal_financial ?? false,
    });
  }, [open, editing]);

  const disabled = readOnly || save.isPending;
  function updateForm(next: typeof form | ((current: typeof form) => typeof form)) {
    setErrors({});
    setForm(next);
  }
  function fieldError(field: string) {
    return errors[field] ? (
      <p id={`contact-${field}-error`} role="alert" className="text-xs text-destructive">
        {errors[field]}
      </p>
    ) : null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!save.isPending) onOpenChange(next);
      }}
    >
      <ReadOnlyProvider readOnly={readOnly}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="shrink-0 border-b px-5 py-4">
            <DialogTitle>
              {readOnly ? "Visualizar contato" : editing ? "Editar contato" : "Novo contato"}
            </DialogTitle>
            <DialogDescription>
              Vincule clientes e organize os canais de contato. Campos com * são obrigatórios.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex min-h-0 flex-1 flex-col"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (disabled) return;
              const result = schema.safeParse(form);
              if (!result.success) {
                const nextErrors: Record<string, string> = {};
                result.error.issues.forEach((issue) => {
                  const path =
                    issue.path[0] === "company_ids" ? "company_ids" : issue.path.join(".");
                  nextErrors[path] ??= issue.message;
                });
                setErrors(nextErrors);
                const first = result.error.issues[0]?.path;
                const fieldId =
                  first?.[0] === "company_ids"
                    ? "contact-companies"
                    : first
                      ? `contact-${first.join("-")}`
                      : "";
                document.getElementById(fieldId)?.focus();
                return;
              }
              setErrors({});
              save.mutate(result.data);
            }}
          >
            <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
              <ReadOnlyNotice show={readOnly} />
              <div className="space-y-1.5">
                <Label htmlFor="contact-companies">Clientes *</Label>
                <ContactCompanySelect
                  companies={companiesQuery.data ?? []}
                  value={form.company_ids}
                  onChange={(ids) => updateForm((current) => ({ ...current, company_ids: ids }))}
                  disabled={disabled}
                  loading={companiesQuery.isLoading}
                  error={companiesQuery.isError}
                  onRetry={() => {
                    void companiesQuery.refetch();
                  }}
                  invalid={!!errors.company_ids}
                />
                {fieldError("company_ids")}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="contact-name">Nome *</Label>
                  <Input
                    id="contact-name"
                    autoComplete="name"
                    value={form.name}
                    disabled={disabled}
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? "contact-name-error" : undefined}
                    onChange={(event) => updateForm({ ...form, name: event.target.value })}
                  />
                  {fieldError("name")}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contact-job_title">Cargo</Label>
                  <Input
                    id="contact-job_title"
                    value={form.job_title}
                    disabled={disabled}
                    aria-invalid={!!errors.job_title}
                    onChange={(event) => updateForm({ ...form, job_title: event.target.value })}
                  />
                  {fieldError("job_title")}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <section
                  className="min-w-0 space-y-2 rounded-lg border p-3"
                  aria-label="E-mails do contato"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-email">E-mail principal *</Label>
                    <Input
                      id="contact-email"
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      disabled={disabled}
                      aria-invalid={!!errors.email}
                      aria-describedby={errors.email ? "contact-email-error" : undefined}
                      placeholder="nome@empresa.com.br"
                      onChange={(event) => updateForm({ ...form, email: event.target.value })}
                    />
                    {fieldError("email")}
                  </div>
                  <ContactSecondaryFields
                    kind="email"
                    values={form.secondary_emails}
                    onChange={(values) =>
                      updateForm((current) => ({ ...current, secondary_emails: values }))
                    }
                    disabled={disabled}
                    errors={errors}
                  />
                </section>
                <section
                  className="min-w-0 space-y-2 rounded-lg border p-3"
                  aria-label="Telefones do contato"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-phone">
                      Telefone principal{" "}
                      <span className="font-normal text-muted-foreground">(opcional)</span>
                    </Label>
                    <Input
                      id="contact-phone"
                      type="tel"
                      autoComplete="tel"
                      value={form.phone}
                      disabled={disabled}
                      aria-invalid={!!errors.phone}
                      aria-describedby={errors.phone ? "contact-phone-error" : undefined}
                      placeholder="55 11 99999-9999"
                      onChange={(event) =>
                        updateForm({ ...form, phone: maskPhone(event.target.value) })
                      }
                    />
                    {fieldError("phone")}
                  </div>
                  <ContactSecondaryFields
                    kind="phone"
                    values={form.secondary_phones}
                    onChange={(values) =>
                      updateForm((current) => ({ ...current, secondary_phones: values }))
                    }
                    disabled={disabled}
                    errors={errors}
                  />
                </section>
              </div>
              <section className="space-y-2" aria-labelledby="contact-permissions-title">
                <h3 id="contact-permissions-title" className="text-sm font-medium">
                  Permissões e preferências
                </h3>
                <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
                  {(
                    [
                      ["can_open_tickets", "Pode abrir tickets", ""],
                      ["receives_csat", "Recebe pesquisa CSAT", ""],
                      ["is_active", "Contato ativo", ""],
                      [
                        "is_portal_admin",
                        "Administrador do portal",
                        "Gerencia contatos da empresa",
                      ],
                      [
                        "is_portal_financial",
                        "Financeiro no portal",
                        "Acessa faturas e documentos",
                      ],
                    ] as const
                  ).map(([field, label, description]) => (
                    <div
                      key={field}
                      className="flex items-center justify-between gap-3 border-b py-2.5"
                    >
                      <div>
                        <Label
                          htmlFor={`contact-${field}`}
                          className="cursor-pointer text-sm font-normal"
                        >
                          {label}
                        </Label>
                        {description && (
                          <p className="text-xs text-muted-foreground">{description}</p>
                        )}
                      </div>
                      <Switch
                        id={`contact-${field}`}
                        checked={form[field]}
                        disabled={disabled}
                        onCheckedChange={(value) =>
                          updateForm((current) => ({ ...current, [field]: value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </section>
            </div>
            <DialogFooter className="shrink-0 gap-2 border-t bg-muted/20 px-5 py-3">
              <Button
                type="button"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => onOpenChange(false)}
              >
                {readOnly ? "Fechar" : "Cancelar"}
              </Button>
              {!readOnly && (
                <Button type="submit" disabled={save.isPending || companiesQuery.isLoading}>
                  {save.isPending && <Loader2 className="size-4 animate-spin" />}
                  {save.isPending ? "Salvando…" : "Salvar contato"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </ReadOnlyProvider>
    </Dialog>
  );
}
