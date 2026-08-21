import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  Mail,
  MessageCircle,
  MessageSquare,
  Globe,
  Hand,
  Upload,
  Eye,
} from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserId } from "@/lib/session";
import { getMyTenantId } from "@/lib/tenant";
import { maskWhatsappPhone } from "@/lib/masks";
import { PageHeader, EmptyStub } from "@/components/empty-stub";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { CompanyTab } from "@/components/settings/CompanyTab";
import { useServerFn } from "@tanstack/react-start";
import { backendClient } from "@/lib/backend-client";
import type { EmailAccountDto, WhatsappInstanceDto } from "@apticket/shared-types";
import { inviteUser, resendInvite } from "@/lib/users.functions";
import { usePermissions } from "@/lib/use-permissions";
import {
  ModulePermissionProvider,
  ReadOnlyNotice,
  ReadOnlyProvider,
  useCurrentModulePermissions,
  useModulePermissions,
} from "@/lib/permission-ui";
import {
  MODULE_ORDER,
  ACTION_LABELS,
  childModules,
  isModuleLocked,
  type ModuleMeta,
} from "@/lib/permission-catalog";
import {
  listRoles,
  listPermissionsCatalog,
  createRole,
  updateRole,
  deleteRole,
  getRolePermissions,
  setRolePermissions,
} from "@/lib/roles.functions";
import {
  listTenantUsers,
  getUserEffectivePermissions,
  assignUserRole,
  setUserOverride,
  restoreUserDefault,
  setUserActive,
} from "@/lib/user-permissions.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Configurações — APTicket" }] }),
  component: SettingsPage,
});

async function getTenantId() {
  const data = { tenant_id: await getMyTenantId() };
  if (!data?.tenant_id) throw new Error("Tenant não encontrado");
  return data.tenant_id;
}

const SETTINGS_TABS = [
  { value: "company", module: "empresa", label: "Empresa" },
  { value: "users", module: "usuarios", label: "Usuários" },
  { value: "roles", module: "papeis", label: "Papéis" },
  { value: "user-permissions", module: "permissoes", label: "Permissões" },
  { value: "departments", module: "departamentos", label: "Departamentos" },
  { value: "service-families", module: "familia_servicos", label: "Família de Serviços" },
  { value: "provided-services", module: "servicos_prestados", label: "Serviços Prestados" },
  { value: "contract-types", module: "tipos_contrato", label: "Tipos de Contrato" },
  { value: "slas", module: "slas", label: "SLAs" },
  { value: "canned", module: "respostas_padrao", label: "Respostas Padrão" },
  { value: "stickers", module: "figurinhas", label: "Figurinhas" },
  { value: "channels", module: "canais", label: "Canais" },
] as const;

function SettingsPage() {
  const perms = usePermissions();
  if (perms.loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  if (!perms.has("configuracoes", "view")) {
    return (
      <div className="p-6">
        <EmptyStub title="Sem acesso" message="Você não tem permissão pra ver Configurações." />
      </div>
    );
  }
  const visibleTabs = SETTINGS_TABS.filter((t) => perms.has(t.module, "view"));
  const firstTab = visibleTabs[0]?.value ?? "company";
  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Configurações"
        subtitle="Usuários, departamentos, SLAs, tipos de contrato, canais e respostas padrão."
      />
      <Tabs defaultValue={firstTab}>
        <TabsList>
          {visibleTabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {perms.has("empresa", "view") && (
          <TabsContent value="company" className="mt-4">
            <ModulePermissionProvider module="empresa">
              <CompanyTab />
            </ModulePermissionProvider>
          </TabsContent>
        )}
        {perms.has("usuarios", "view") && (
          <TabsContent value="users" className="mt-4">
            <ModulePermissionProvider module="usuarios">
              <UsersTab />
            </ModulePermissionProvider>
          </TabsContent>
        )}
        {perms.has("papeis", "view") && (
          <TabsContent value="roles" className="mt-4">
            <ModulePermissionProvider module="papeis">
              <RolesTab />
            </ModulePermissionProvider>
          </TabsContent>
        )}
        {perms.has("permissoes", "view") && (
          <TabsContent value="user-permissions" className="mt-4">
            <ModulePermissionProvider module="permissoes">
              <UserPermissionsTab />
            </ModulePermissionProvider>
          </TabsContent>
        )}
        {perms.has("departamentos", "view") && (
          <TabsContent value="departments" className="mt-4">
            <ModulePermissionProvider module="departamentos">
              <DepartmentsTab />
            </ModulePermissionProvider>
          </TabsContent>
        )}
        {perms.has("familia_servicos", "view") && (
          <TabsContent value="service-families" className="mt-4">
            <ModulePermissionProvider module="familia_servicos">
              <ServiceFamiliesTab />
            </ModulePermissionProvider>
          </TabsContent>
        )}
        {perms.has("servicos_prestados", "view") && (
          <TabsContent value="provided-services" className="mt-4">
            <ModulePermissionProvider module="servicos_prestados">
              <ProvidedServicesTab />
            </ModulePermissionProvider>
          </TabsContent>
        )}
        {perms.has("tipos_contrato", "view") && (
          <TabsContent value="contract-types" className="mt-4">
            <ModulePermissionProvider module="tipos_contrato">
              <ContractTypesTab />
            </ModulePermissionProvider>
          </TabsContent>
        )}
        {perms.has("slas", "view") && (
          <TabsContent value="slas" className="mt-4">
            <ModulePermissionProvider module="slas">
              <SlasTab />
            </ModulePermissionProvider>
          </TabsContent>
        )}
        {perms.has("respostas_padrao", "view") && (
          <TabsContent value="canned" className="mt-4">
            <ModulePermissionProvider module="respostas_padrao">
              <CannedTab />
            </ModulePermissionProvider>
          </TabsContent>
        )}
        {perms.has("figurinhas", "view") && (
          <TabsContent value="stickers" className="mt-4">
            <ModulePermissionProvider module="figurinhas">
              <StickersTab />
            </ModulePermissionProvider>
          </TabsContent>
        )}
        {perms.has("canais", "view") && (
          <TabsContent value="channels" className="mt-4">
            <ModulePermissionProvider module="canais">
              <ChannelsTab />
            </ModulePermissionProvider>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

/* ============================ USERS ============================ */

type Profile = { id: string; name: string; email: string; is_active: boolean };

function UsersTab() {
  const qc = useQueryClient();
  const invite = useServerFn(inviteUser);
  const resend = useServerFn(resendInvite);
  const listUsers = useServerFn(listTenantUsers);
  const listRolesFn = useServerFn(listRoles);
  const assignRole = useServerFn(assignUserRole);
  const updateUserActive = useServerFn(setUserActive);
  const perms = usePermissions();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", roleId: "" });

  const { data: rolesList } = useQuery({
    queryKey: ["settings_roles_list"],
    queryFn: () => listRolesFn(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["settings_users"],
    queryFn: () => listUsers(),
  });

  const sendInvite = useMutation({
    mutationFn: async () => {
      const parsed = z
        .object({
          name: z.string().trim().min(1, "Informe o nome").max(120),
          email: z.string().trim().email("E-mail inválido").max(255),
          roleId: z.string().uuid("Escolha um papel"),
        })
        .parse(form);
      return await invite({ data: parsed });
    },
    onSuccess: (res) => {
      toast.success(`Convite enviado para ${res.email}`);
      setInviteOpen(false);
      setForm({ name: "", email: "", roleId: "" });
      qc.invalidateQueries({ queryKey: ["settings_users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setRole = useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) => {
      if (!perms.has("usuarios", "edit")) throw new Error("Sem permissão para editar usuários");
      return assignRole({ data: { userId, roleId } });
    },
    onSuccess: () => {
      toast.success("Papel atualizado");
      qc.invalidateQueries({ queryKey: ["settings_users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => {
      if (!perms.has("usuarios", "edit")) throw new Error("Sem permissão para editar usuários");
      return updateUserActive({ data: { userId: id, isActive: is_active } });
    },
    onSuccess: () => {
      toast.success("Status atualizado");
      qc.invalidateQueries({ queryKey: ["settings_users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resendInviteMutation = useMutation({
    mutationFn: (userId: string) => resend({ data: { userId } }),
    onSuccess: (res) => toast.success(`Convite reenviado para ${res.email}`),
    onError: (e: Error) => toast.error(e.message),
  });

  const inviteDialog = (
    <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar usuário</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="invite-name">Nome</Label>
            <Input
              id="invite-name"
              value={form.name}
              maxLength={120}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-email">E-mail</Label>
            <Input
              id="invite-email"
              type="email"
              value={form.email}
              maxLength={255}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label>Papel</Label>
            <Select
              value={form.roleId}
              onValueChange={(v: string) => setForm((f) => ({ ...f, roleId: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Escolha um papel" />
              </SelectTrigger>
              <SelectContent>
                {rolesList?.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            O convidado recebe um e-mail para definir a senha e já entra nesta organização.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setInviteOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={() => sendInvite.mutate()} disabled={sendInvite.isPending}>
            {sendInvite.isPending ? "Enviando…" : "Enviar convite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const header = (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold">Usuários</h3>
      {perms.has("usuarios", "create") ? (
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Convidar usuário
        </Button>
      ) : null}
    </div>
  );

  if (isLoading)
    return <Card className="p-8 text-center text-sm text-muted-foreground">Carregando…</Card>;

  return (
    <div className="space-y-3">
      {header}
      {!data?.length ? (
        <EmptyStub title="Sem usuários" message="Convide membros para o workspace." />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((u) => {
                const currentRoleId = u.user_roles?.role_id ?? "";
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="text-sm">{u.email}</TableCell>
                    <TableCell>
                      <Select
                        value={currentRoleId}
                        disabled={!perms.has("usuarios", "edit")}
                        onValueChange={(v: string) => setRole.mutate({ userId: u.id, roleId: v })}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue placeholder="Sem papel" />
                        </SelectTrigger>
                        <SelectContent>
                          {rolesList?.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={u.is_active}
                        disabled={!perms.has("usuarios", "edit")}
                        onCheckedChange={(v) => toggleActive.mutate({ id: u.id, is_active: v })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {!u.is_active && perms.has("usuarios", "create") ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resendInviteMutation.isPending}
                          onClick={() => resendInviteMutation.mutate(u.id)}
                        >
                          <Mail className="h-3.5 w-3.5 mr-1" /> Reenviar convite
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      {inviteDialog}
    </div>
  );
}

/* ============================ ROLES (Bloco 2) ============================ */

type RoleRow = { id: string; name: string; description: string | null; is_system: boolean };
type PermissionRow = { id: string; module: string; action: string; description: string | null };

function indexByModule(permissions: PermissionRow[]): Map<string, PermissionRow[]> {
  const byModule = new Map<string, PermissionRow[]>();
  for (const p of permissions) {
    if (!byModule.has(p.module)) byModule.set(p.module, []);
    byModule.get(p.module)!.push(p);
  }
  return byModule;
}

function RoleModuleRow({
  meta,
  perms,
  checked,
  isSystem,
  locked,
  hasViewChecked,
  onToggle,
}: {
  meta: ModuleMeta;
  perms: PermissionRow[];
  checked: Set<string>;
  isSystem: boolean;
  locked: boolean;
  hasViewChecked: boolean;
  onToggle: (module: string, action: string, permId: string) => void;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-1">{meta.label}</div>
      <div className="flex flex-wrap gap-4">
        {meta.actions.map((action) => {
          const p = perms.find((x) => x.action === action);
          if (!p) return null;
          const disabled = isSystem || locked || (action !== "view" && !hasViewChecked);
          return (
            <label
              key={p.id}
              className={`flex items-center gap-1.5 text-sm ${disabled && !isSystem ? "opacity-40" : ""}`}
            >
              <Checkbox
                checked={isSystem || checked.has(p.id)}
                disabled={disabled}
                onCheckedChange={() => onToggle(meta.key, action, p.id)}
              />
              {ACTION_LABELS[action] ?? action}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function RolesTab() {
  const access = useModulePermissions("papeis");
  const qc = useQueryClient();
  const listRolesFn = useServerFn(listRoles);
  const listCatalog = useServerFn(listPermissionsCatalog);
  const getPerms = useServerFn(getRolePermissions);
  const saveRolePerms = useServerFn(setRolePermissions);
  const createRoleFn = useServerFn(createRole);
  const updateRoleFn = useServerFn(updateRole);
  const deleteRoleFn = useServerFn(deleteRole);

  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);
  const roleReadOnly = editing ? !access.edit : !access.create;

  const { data: roles } = useQuery({ queryKey: ["roles_list"], queryFn: () => listRolesFn() });
  const { data: catalog } = useQuery({
    queryKey: ["permissions_catalog"],
    queryFn: () => listCatalog(),
  });
  const { data: rolePerms } = useQuery({
    queryKey: ["role_permissions", selected],
    queryFn: () => getPerms({ data: { roleId: selected! } }),
    enabled: !!selected,
  });

  useEffect(() => {
    setChecked(new Set(rolePerms ?? []));
  }, [rolePerms]);

  const selectedRole = roles?.find((r) => r.id === selected) ?? null;

  const saveRole = useMutation({
    mutationFn: async () => {
      if (editing && !access.edit) throw new Error("Sem permissão para editar papéis");
      if (!editing && !access.create) throw new Error("Sem permissão para criar papéis");
      const parsed = z
        .object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(300) })
        .parse(form);
      if (editing) {
        return updateRoleFn({ data: { roleId: editing.id, ...parsed } });
      }
      return createRoleFn({ data: parsed });
    },
    onSuccess: () => {
      toast.success(editing ? "Papel atualizado" : "Papel criado");
      setDialogOpen(false);
      setEditing(null);
      setForm({ name: "", description: "" });
      qc.invalidateQueries({ queryKey: ["roles_list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRole = useMutation({
    mutationFn: (roleId: string) => {
      if (!access.delete) throw new Error("Sem permissão para excluir papéis");
      return deleteRoleFn({ data: { roleId } });
    },
    onSuccess: () => {
      toast.success("Papel excluído");
      setDeleteTarget(null);
      if (selected === deleteTarget?.id) setSelected(null);
      qc.invalidateQueries({ queryKey: ["roles_list"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setDeleteTarget(null);
    },
  });

  const saveMatrix = useMutation({
    mutationFn: () => {
      if (!access.edit) throw new Error("Sem permissão para editar papéis");
      return saveRolePerms({ data: { roleId: selected!, permissionIds: Array.from(checked) } });
    },
    onSuccess: () => {
      toast.success("Matriz de permissões salva");
      qc.invalidateQueries({ queryKey: ["role_permissions", selected] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const permsByModule = useMemo(() => indexByModule(catalog ?? []), [catalog]);
  const permIdOf = (module: string, action: string) =>
    permsByModule.get(module)?.find((p) => p.action === action)?.id;
  const hasViewChecked = (module: string) => {
    const id = permIdOf(module, "view");
    return id ? checked.has(id) : false;
  };

  // Visualiza desmarcado trava/desmarca o resto do módulo — e, sendo
  // Configurações, desmarca os sub-itens inteiros junto (pedido do usuário:
  // sem ver Configurações não faz sentido ver nada debaixo dela).
  const toggle = (module: string, action: string, permId: string) => {
    if (!access.edit) return;
    if (selectedRole?.is_system) return;
    setChecked((prev) => {
      const already = prev.has(permId);
      if (action === "view" && already) {
        const next = new Set(prev);
        for (const p of permsByModule.get(module) ?? []) next.delete(p.id);
        for (const child of childModules(module)) {
          for (const p of permsByModule.get(child.key) ?? []) next.delete(p.id);
        }
        return next;
      }
      if (action !== "view" && !already && !hasViewChecked(module)) return prev; // travado
      const next = new Set(prev);
      if (already) next.delete(permId);
      else next.add(permId);
      return next;
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      <Card className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Papéis</h3>
          {access.create && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setForm({ name: "", description: "" });
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Novo
            </Button>
          )}
        </div>
        <div className="space-y-1">
          {roles?.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelected(r.id)}
              className={`w-full flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                selected === r.id ? "bg-muted font-medium" : ""
              }`}
            >
              <span className="flex items-center gap-2">
                {r.name}
                {r.is_system ? (
                  <Badge variant="secondary" className="text-[10px]">
                    sistema
                  </Badge>
                ) : null}
              </span>
              <span className="flex gap-1">
                {access.edit ? (
                  <Pencil
                    className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(r);
                      setForm({ name: r.name, description: r.description ?? "" });
                      setDialogOpen(true);
                    }}
                  />
                ) : (
                  <Eye
                    className="h-3.5 w-3.5 text-muted-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(r);
                      setForm({ name: r.name, description: r.description ?? "" });
                      setDialogOpen(true);
                    }}
                  />
                )}
                {!r.is_system && access.delete && (
                  <Trash2
                    className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(r);
                    }}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        {!selected ? (
          <p className="text-sm text-muted-foreground">Selecione um papel pra ver a matriz.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Permissões — {selectedRole?.name}</h3>
              {!selectedRole?.is_system && access.edit && (
                <Button
                  size="sm"
                  onClick={() => saveMatrix.mutate()}
                  disabled={saveMatrix.isPending}
                >
                  {saveMatrix.isPending ? "Salvando…" : "Salvar matriz"}
                </Button>
              )}
            </div>
            {selectedRole?.is_system && (
              <p className="text-xs text-muted-foreground">
                Papel de sistema — tem acesso total, não pode ser restringido.
              </p>
            )}
            <div className="space-y-3">
              {MODULE_ORDER.filter((m) => !m.parent).map((m) => (
                <div key={m.key}>
                  <RoleModuleRow
                    meta={m}
                    perms={permsByModule.get(m.key) ?? []}
                    checked={checked}
                    isSystem={!!selectedRole?.is_system || !access.edit}
                    locked={isModuleLocked(m.key, hasViewChecked)}
                    hasViewChecked={hasViewChecked(m.key)}
                    onToggle={toggle}
                  />
                  {childModules(m.key).length > 0 && (
                    <div className="ml-5 mt-2 space-y-2 border-l pl-3">
                      {childModules(m.key).map((c) => (
                        <RoleModuleRow
                          key={c.key}
                          meta={c}
                          perms={permsByModule.get(c.key) ?? []}
                          checked={checked}
                          isSystem={!!selectedRole?.is_system || !access.edit}
                          locked={isModuleLocked(c.key, hasViewChecked)}
                          hasViewChecked={hasViewChecked(c.key)}
                          onToggle={toggle}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <ReadOnlyProvider readOnly={roleReadOnly}>
          <DialogContent>
            <ReadOnlyNotice show={roleReadOnly} />
            <DialogHeader>
              <DialogTitle>{editing ? "Editar papel" : "Novo papel"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="role-name">Nome</Label>
                <Input
                  id="role-name"
                  value={form.name}
                  maxLength={80}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="role-desc">Descrição</Label>
                <Textarea
                  id="role-desc"
                  value={form.description}
                  maxLength={300}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              {(editing ? access.edit : access.create) && (
                <Button onClick={() => saveRole.mutate()} disabled={saveRole.isPending}>
                  {saveRole.isPending ? "Salvando…" : "Salvar"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </ReadOnlyProvider>
      </Dialog>

      {access.delete && (
        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir papel "{deleteTarget?.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Só é possível excluir papéis sem usuários atribuídos.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteTarget && removeRole.mutate(deleteTarget.id)}>
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

/* ============================ PERMISSÕES POR USUÁRIO (Bloco 2) ============================ */

type EffectiveRow = {
  module: string;
  action: string;
  granted_by_role: boolean;
  override: boolean | null;
  effective: boolean;
};

function UserModuleRow({
  meta,
  perms,
  effectiveByPermission,
  locked,
  hasEffectiveView,
  onGrant,
  onRevoke,
  onRestore,
  editable,
}: {
  meta: ModuleMeta;
  perms: PermissionRow[];
  effectiveByPermission: Map<string, EffectiveRow>;
  locked: boolean;
  hasEffectiveView: boolean;
  onGrant: (permissionId: string) => void;
  onRevoke: (permissionId: string) => void;
  onRestore: (permissionId: string) => void;
  editable: boolean;
}) {
  const colors: Record<string, string> = {
    "inherited-on": "bg-muted text-foreground border-border",
    "inherited-off": "bg-transparent text-muted-foreground border-border",
    granted: "bg-green-100 text-green-800 border-green-300",
    revoked: "bg-red-100 text-red-800 border-red-300",
  };
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-1">{meta.label}</div>
      <div className="flex flex-wrap gap-2">
        {meta.actions.map((action) => {
          const p = perms.find((x) => x.action === action);
          if (!p) return null;
          const eff = effectiveByPermission.get(`${meta.key}:${action}`);
          const isOverride = eff?.override !== null && eff?.override !== undefined;
          const state = isOverride
            ? eff!.override
              ? "granted"
              : "revoked"
            : eff?.granted_by_role
              ? "inherited-on"
              : "inherited-off";
          const rowLocked = locked || (action !== "view" && !hasEffectiveView);
          return (
            <div
              key={p.id}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${colors[state]} ${rowLocked ? "opacity-40" : ""}`}
            >
              <span>{ACTION_LABELS[action] ?? action}</span>
              {editable && !rowLocked && state !== "granted" && (
                <button title="Conceder" className="hover:underline" onClick={() => onGrant(p.id)}>
                  +
                </button>
              )}
              {editable && !rowLocked && state !== "revoked" && (
                <button title="Revogar" className="hover:underline" onClick={() => onRevoke(p.id)}>
                  −
                </button>
              )}
              {editable && !rowLocked && isOverride && (
                <button
                  title="Restaurar padrão do papel"
                  className="hover:underline"
                  onClick={() => onRestore(p.id)}
                >
                  ↺
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UserPermissionsTab() {
  const access = useModulePermissions("permissoes");
  const listUsersFn = useServerFn(listTenantUsers);
  const listRolesFn = useServerFn(listRoles);
  const listCatalog = useServerFn(listPermissionsCatalog);
  const getEffective = useServerFn(getUserEffectivePermissions);
  const assignRole = useServerFn(assignUserRole);
  const setOverride = useServerFn(setUserOverride);
  const restoreDefault = useServerFn(restoreUserDefault);
  const qc = useQueryClient();

  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const { data: users } = useQuery({ queryKey: ["perm_users"], queryFn: () => listUsersFn() });
  const { data: roles } = useQuery({ queryKey: ["perm_roles"], queryFn: () => listRolesFn() });
  const { data: catalog } = useQuery({
    queryKey: ["permissions_catalog"],
    queryFn: () => listCatalog(),
  });
  const { data: effective, refetch: refetchEffective } = useQuery({
    queryKey: ["user_effective_permissions", selectedUser],
    queryFn: () => getEffective({ data: { userId: selectedUser! } }),
    enabled: !!selectedUser,
  });

  const user = users?.find((u) => u.id === selectedUser) ?? null;
  const currentRoleId = user?.user_roles?.role_id ?? "";

  const changeRole = useMutation({
    mutationFn: (roleId: string) => {
      if (!access.edit) throw new Error("Sem permissão para editar permissões");
      return assignRole({ data: { userId: selectedUser!, roleId } });
    },
    onSuccess: () => {
      toast.success("Papel atualizado");
      qc.invalidateQueries({ queryKey: ["perm_users"] });
      refetchEffective();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const override = useMutation({
    mutationFn: (vars: { permissionId: string; granted: boolean }) => {
      if (!access.edit) throw new Error("Sem permissão para editar permissões");
      return setOverride({ data: { userId: selectedUser!, ...vars } });
    },
    onSuccess: () => refetchEffective(),
    onError: (e: Error) => toast.error(e.message),
  });

  const restore = useMutation({
    mutationFn: (permissionId: string) => {
      if (!access.edit) throw new Error("Sem permissão para editar permissões");
      return restoreDefault({ data: { userId: selectedUser!, permissionId } });
    },
    onSuccess: () => refetchEffective(),
    onError: (e: Error) => toast.error(e.message),
  });

  const effectiveByPermission = new Map<string, EffectiveRow>(
    (effective ?? []).map((e) => [`${e.module}:${e.action}`, e]),
  );
  const permsByModule = useMemo(() => indexByModule(catalog ?? []), [catalog]);
  const hasEffectiveView = (module: string) =>
    effectiveByPermission.get(`${module}:view`)?.effective ?? false;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      <Card className="p-3 space-y-1">
        <h3 className="text-sm font-semibold mb-2">Usuários</h3>
        {users?.map((u) => (
          <button
            key={u.id}
            onClick={() => setSelectedUser(u.id)}
            className={`w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
              selectedUser === u.id ? "bg-muted font-medium" : ""
            }`}
          >
            {u.name}
            <div className="text-xs text-muted-foreground">{u.email}</div>
          </button>
        ))}
      </Card>

      <Card className="p-4">
        {!user ? (
          <p className="text-sm text-muted-foreground">Selecione um usuário.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold">{user.name}</h3>
              <Select
                value={currentRoleId}
                disabled={!access.edit}
                onValueChange={(v) => changeRole.mutate(v)}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Papel" />
                </SelectTrigger>
                <SelectContent>
                  {roles?.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Cinza = herdado do papel · verde = concedido individualmente · vermelho = revogado
              individualmente.
            </p>
            <div className="space-y-3">
              {MODULE_ORDER.filter((m) => !m.parent).map((m) => (
                <div key={m.key}>
                  <UserModuleRow
                    meta={m}
                    perms={permsByModule.get(m.key) ?? []}
                    effectiveByPermission={effectiveByPermission}
                    locked={isModuleLocked(m.key, hasEffectiveView)}
                    hasEffectiveView={hasEffectiveView(m.key)}
                    onGrant={(id) => override.mutate({ permissionId: id, granted: true })}
                    onRevoke={(id) => override.mutate({ permissionId: id, granted: false })}
                    onRestore={(id) => restore.mutate(id)}
                    editable={access.edit}
                  />
                  {childModules(m.key).length > 0 && (
                    <div className="ml-5 mt-2 space-y-2 border-l pl-3">
                      {childModules(m.key).map((c) => (
                        <UserModuleRow
                          key={c.key}
                          meta={c}
                          perms={permsByModule.get(c.key) ?? []}
                          effectiveByPermission={effectiveByPermission}
                          locked={isModuleLocked(c.key, hasEffectiveView)}
                          hasEffectiveView={hasEffectiveView(c.key)}
                          onGrant={(id) => override.mutate({ permissionId: id, granted: true })}
                          onRevoke={(id) => override.mutate({ permissionId: id, granted: false })}
                          onRestore={(id) => restore.mutate(id)}
                          editable={access.edit}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============================ Generic CRUD section helper ============================ */

type CrudRow = { id: string };

function CrudDialogContent({
  editing,
  className = "",
  children,
}: {
  editing: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const access = useCurrentModulePermissions();
  const readOnly = editing ? !access.edit : !access.create;
  return (
    <ReadOnlyProvider readOnly={readOnly}>
      <DialogContent className={`${className} ${readOnly ? "[&_button[type=submit]]:hidden" : ""}`}>
        <ReadOnlyNotice show={readOnly} />
        {children}
      </DialogContent>
    </ReadOnlyProvider>
  );
}

function CrudHeader({ title, onNew }: { title: string; onNew: () => void }) {
  const access = useCurrentModulePermissions();
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold">{title}</h3>
      {access.create && (
        <Button size="sm" onClick={onNew}>
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      )}
    </div>
  );
}

function RowActions<T extends CrudRow>({
  row,
  onEdit,
  onDelete,
}: {
  row: T;
  onEdit: (r: T) => void;
  onDelete: (r: T) => void;
}) {
  const access = useCurrentModulePermissions();
  return (
    <div className="text-right">
      <Button variant="ghost" size="icon" onClick={() => onEdit(row)}>
        {access.edit ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
      {access.delete && (
        <Button variant="ghost" size="icon" onClick={() => onDelete(row)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

/* ============================ DEPARTMENTS ============================ */

type Department = { id: string; name: string; description: string | null };
const deptSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório").max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

function DepartmentsTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [toDelete, setToDelete] = useState<Department | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("*").order("name");
      if (error) throw error;
      return data as Department[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("departments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["departments"] });
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <CrudHeader
        title="Departamentos"
        onNew={() => {
          setEditing(null);
          setOpen(true);
        }}
      />
      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>
      ) : !data?.length ? (
        <EmptyStub
          title="Nenhum departamento"
          message="Crie departamentos para rotear tickets (ex.: Suporte N1, Infra, Field)."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {d.description || "—"}
                  </TableCell>
                  <TableCell>
                    <RowActions
                      row={d}
                      onEdit={(r) => {
                        setEditing(r);
                        setOpen(true);
                      }}
                      onDelete={setToDelete}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <DepartmentDialog open={open} onOpenChange={setOpen} editing={editing} />
      <ConfirmDelete
        open={!!toDelete}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
        title="Remover departamento?"
        body={
          <>
            Departamento <b>{toDelete?.name}</b> será removido.
          </>
        }
      />
    </div>
  );
}

function DepartmentDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Department | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", description: "" });

  useEffect(() => {
    if (!open) return;
    setForm({ name: editing?.name ?? "", description: editing?.description ?? "" });
  }, [open, editing]);

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof deptSchema>) => {
      const tenant_id = await getTenantId();
      const values = { name: payload.name, description: payload.description || null };
      if (editing) {
        const { error } = await supabase.from("departments").update(values).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("departments").insert({ ...values, tenant_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Salvo");
      qc.invalidateQueries({ queryKey: ["departments"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <CrudDialogContent editing={!!editing}>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar" : "Novo"} departamento</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const r = deptSchema.safeParse(form);
            if (!r.success) return toast.error(r.error.issues[0].message);
            save.mutate(r.data);
          }}
        >
          <div>
            <Label>Nome *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </CrudDialogContent>
    </Dialog>
  );
}

/* ============================ SERVICE FAMILIES ============================ */

type ServiceFamily = { id: string; code: string; description: string; is_active: boolean };
const familySchema = z.object({
  code: z.string().trim().min(1, "Código obrigatório").max(40),
  description: z.string().trim().min(1, "Descrição obrigatória").max(200),
  is_active: z.boolean(),
});

function ServiceFamiliesTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceFamily | null>(null);
  const [toDelete, setToDelete] = useState<ServiceFamily | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["service_families"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_families")
        .select("id, code, description, is_active")
        .order("code");
      if (error) throw error;
      return data as ServiceFamily[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("service_families").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["service_families"] });
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <CrudHeader
        title="Família de Serviços"
        onNew={() => {
          setEditing(null);
          setOpen(true);
        }}
      />
      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>
      ) : !data?.length ? (
        <EmptyStub
          title="Nenhuma família de serviços"
          message="Agrupe os serviços prestados por família (ex.: Redes, Hardware, Backup)."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-20">Status</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs">{f.code}</TableCell>
                  <TableCell className="font-medium">{f.description}</TableCell>
                  <TableCell>
                    <Badge variant={f.is_active ? "default" : "outline"}>
                      {f.is_active ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <RowActions
                      row={f}
                      onEdit={(r) => {
                        setEditing(r);
                        setOpen(true);
                      }}
                      onDelete={setToDelete}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <ServiceFamilyDialog open={open} onOpenChange={setOpen} editing={editing} />
      <ConfirmDelete
        open={!!toDelete}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
        title="Remover família de serviços?"
        body={
          <>
            Família <b>{toDelete?.description}</b> será removida. Serviços prestados vinculados a
            ela impedem a exclusão — inative em vez de excluir, se necessário.
          </>
        }
      />
    </div>
  );
}

function ServiceFamilyDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: ServiceFamily | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ code: "", description: "", is_active: true });

  useEffect(() => {
    if (!open) return;
    setForm({
      code: editing?.code ?? "",
      description: editing?.description ?? "",
      is_active: editing?.is_active ?? true,
    });
  }, [open, editing]);

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof familySchema>) => {
      const tenant_id = await getTenantId();
      if (editing) {
        const { error } = await supabase
          .from("service_families")
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("service_families").insert({ ...payload, tenant_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Salvo");
      qc.invalidateQueries({ queryKey: ["service_families"] });
      qc.invalidateQueries({ queryKey: ["provided_services"] });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast.error(e.message.includes("duplicate") ? "Código já cadastrado" : e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <CrudDialogContent editing={!!editing}>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar" : "Nova"} família de serviços</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const r = familySchema.safeParse(form);
            if (!r.success) return toast.error(r.error.issues[0].message);
            save.mutate(r.data);
          }}
        >
          <div>
            <Label>Código *</Label>
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div>
            <Label>Descrição *</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label className="text-sm">Ativo</Label>
            <Switch
              checked={form.is_active}
              onCheckedChange={(v) => setForm({ ...form, is_active: v })}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </CrudDialogContent>
    </Dialog>
  );
}

/* ============================ PROVIDED SERVICES ============================ */

type ProvidedService = {
  id: string;
  code: string;
  description: string;
  family_id: string;
  includes_remote: boolean;
  includes_lab: boolean;
  includes_onsite: boolean;
  is_active: boolean;
  service_families?: { description: string } | null;
};
const providedServiceSchema = z.object({
  code: z.string().trim().min(1, "Código obrigatório").max(40),
  description: z.string().trim().min(1, "Descrição obrigatória").max(200),
  family_id: z.string().uuid("Selecione a família"),
  includes_remote: z.boolean(),
  includes_lab: z.boolean(),
  includes_onsite: z.boolean(),
  is_active: z.boolean(),
});

function ProvidedServicesTab() {
  const access = useCurrentModulePermissions();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProvidedService | null>(null);
  const [toDelete, setToDelete] = useState<ProvidedService | null>(null);
  const [familyFilter, setFamilyFilter] = useState<string>("all");

  const { data: families = [] } = useQuery({
    queryKey: ["service_families", "options"],
    queryFn: async () =>
      (await supabase.from("service_families").select("id, description").order("description"))
        .data ?? [],
  });

  const { data, isLoading } = useQuery({
    queryKey: ["provided_services"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provided_services")
        .select(
          "id, code, description, family_id, includes_remote, includes_lab, includes_onsite, is_active, service_families(description)",
        )
        .order("code");
      if (error) throw error;
      return data as unknown as ProvidedService[];
    },
  });

  const filtered = useMemo(
    () =>
      familyFilter === "all"
        ? (data ?? [])
        : (data ?? []).filter((s) => s.family_id === familyFilter),
    [data, familyFilter],
  );

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("provided_services").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["provided_services"] });
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Serviços Prestados</h3>
        <div className="flex items-center gap-2">
          <Select value={familyFilter} onValueChange={setFamilyFilter}>
            <SelectTrigger className="h-8 w-[200px] text-xs">
              <SelectValue placeholder="Todas famílias" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas famílias</SelectItem>
              {families.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {access.create && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Novo
            </Button>
          )}
        </div>
      </div>
      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>
      ) : !filtered.length ? (
        <EmptyStub
          title="Nenhum serviço prestado"
          message="Cadastre os serviços que a equipe executa, vinculados a uma família."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Família</TableHead>
                <TableHead>Execução</TableHead>
                <TableHead className="w-20">Status</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => {
                const modes = [
                  s.includes_remote && "Remoto",
                  s.includes_lab && "Laboratório",
                  s.includes_onsite && "Visita",
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.code}</TableCell>
                    <TableCell className="font-medium">{s.description}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.service_families?.description ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{modes || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={s.is_active ? "default" : "outline"}>
                        {s.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <RowActions
                        row={s}
                        onEdit={(r) => {
                          setEditing(r);
                          setOpen(true);
                        }}
                        onDelete={setToDelete}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <ProvidedServiceDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        families={families}
      />
      <ConfirmDelete
        open={!!toDelete}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
        title="Remover serviço prestado?"
        body={
          <>
            Serviço <b>{toDelete?.description}</b> será removido.
          </>
        }
      />
    </div>
  );
}

function ProvidedServiceDialog({
  open,
  onOpenChange,
  editing,
  families,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: ProvidedService | null;
  families: { id: string; description: string }[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    code: "",
    description: "",
    family_id: "",
    includes_remote: false,
    includes_lab: false,
    includes_onsite: false,
    is_active: true,
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      code: editing?.code ?? "",
      description: editing?.description ?? "",
      family_id: editing?.family_id ?? "",
      includes_remote: editing?.includes_remote ?? false,
      includes_lab: editing?.includes_lab ?? false,
      includes_onsite: editing?.includes_onsite ?? false,
      is_active: editing?.is_active ?? true,
    });
  }, [open, editing]);

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof providedServiceSchema>) => {
      const tenant_id = await getTenantId();
      if (editing) {
        const { error } = await supabase
          .from("provided_services")
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("provided_services")
          .insert({ ...payload, tenant_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Salvo");
      qc.invalidateQueries({ queryKey: ["provided_services"] });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast.error(e.message.includes("duplicate") ? "Código já cadastrado" : e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <CrudDialogContent editing={!!editing}>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar" : "Novo"} serviço prestado</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const r = providedServiceSchema.safeParse(form);
            if (!r.success) return toast.error(r.error.issues[0].message);
            save.mutate(r.data);
          }}
        >
          <div>
            <Label>Código *</Label>
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div>
            <Label>Descrição *</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div>
            <Label>Família *</Label>
            <Select
              value={form.family_id}
              onValueChange={(v) => setForm({ ...form, family_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {families.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Tipo(s) de execução</Label>
            <div className="flex items-center justify-between text-sm">
              <span>Suporte remoto</span>
              <Switch
                checked={form.includes_remote}
                onCheckedChange={(v) => setForm({ ...form, includes_remote: v })}
              />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Laboratório</span>
              <Switch
                checked={form.includes_lab}
                onCheckedChange={(v) => setForm({ ...form, includes_lab: v })}
              />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Visita técnica</span>
              <Switch
                checked={form.includes_onsite}
                onCheckedChange={(v) => setForm({ ...form, includes_onsite: v })}
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label className="text-sm">Ativo</Label>
            <Switch
              checked={form.is_active}
              onCheckedChange={(v) => setForm({ ...form, is_active: v })}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </CrudDialogContent>
    </Dialog>
  );
}

/* ============================ CONTRACT TYPES ============================ */

type BillingModel = "hours_package" | "per_equipment" | "per_service";
type EquipmentTier = { min: number; max: number; price: number };
type ServiceItem = { reference: string; description: string; quantity: number; price: number };
type ContractType = {
  id: string;
  name: string;
  description: string | null;
  billing_model: BillingModel;
  default_hours_monthly: number;
  default_monthly_value: number;
  equipment_min: number | null;
  equipment_max: number | null;
  price_per_equipment: number | null;
  equipment_tiers: EquipmentTier[] | null;
  service_items: ServiceItem[] | null;
  includes_remote: boolean;
  includes_lab: boolean;
  includes_onsite: boolean;
};
const tierSchema = z.object({
  min: z.coerce.number().int().min(0).max(100000),
  max: z.coerce.number().int().min(0).max(100000),
  price: z.coerce.number().min(0).max(9999999),
});
const serviceSchema = z.object({
  reference: z.string().trim().max(60),
  description: z.string().trim().max(200),
  quantity: z.coerce.number().min(0).max(100000),
  price: z.coerce.number().min(0).max(9999999),
});
const ctSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório").max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  billing_model: z.enum(["hours_package", "per_equipment", "per_service"]),
  default_hours_monthly: z.coerce.number().int().min(0).max(10000),
  default_monthly_value: z.coerce.number().min(0).max(9999999),
  equipment_tiers: z.array(tierSchema),
  service_items: z.array(serviceSchema),
  includes_remote: z.boolean(),
  includes_lab: z.boolean(),
  includes_onsite: z.boolean(),
});

const BILLING_LABEL: Record<BillingModel, string> = {
  hours_package: "Pacote de horas",
  per_equipment: "Por equipamento",
  per_service: "Por serviço",
};

function ContractTypesTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ContractType | null>(null);
  const [toDelete, setToDelete] = useState<ContractType | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["contract_types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("contract_types").select("*").order("name");
      if (error) throw error;
      return data as ContractType[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contract_types").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["contract_types"] });
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <CrudHeader
        title="Tipos de contrato"
        onNew={() => {
          setEditing(null);
          setOpen(true);
        }}
      />
      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>
      ) : !data?.length ? (
        <EmptyStub
          title="Nenhum tipo de contrato"
          message="Defina presets (ex.: Pacote 10h ou faixa 1–10 equipamentos) para acelerar a criação de contratos."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Detalhes</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Inclui</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((t) => {
                const inclui =
                  [
                    t.includes_remote && "Remoto",
                    t.includes_lab && "Laboratório",
                    t.includes_onsite && "Visita",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—";
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      <div>{t.name}</div>
                      {t.description && (
                        <div className="text-xs text-muted-foreground">{t.description}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{BILLING_LABEL[t.billing_model]}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.billing_model === "hours_package"
                        ? `${t.default_hours_monthly}h/mês`
                        : t.billing_model === "per_service"
                          ? `${t.service_items?.length ?? 0} serviço(s)`
                          : t.equipment_tiers?.length
                            ? `${t.equipment_tiers.length} faixa(s)`
                            : `${t.equipment_min ?? 0} a ${t.equipment_max ?? 0} equip.`}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.billing_model === "hours_package" ? (
                        Number(t.default_monthly_value).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })
                      ) : t.billing_model === "per_service" ? (
                        Number(
                          (t.service_items ?? []).reduce(
                            (s, it) => s + Number(it.quantity || 0) * Number(it.price || 0),
                            0,
                          ),
                        ).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                      ) : t.equipment_tiers?.length ? (
                        <div className="space-y-0.5">
                          {t.equipment_tiers.map((f, i) => (
                            <div key={i} className="text-xs">
                              {f.min}–{f.max}:{" "}
                              {Number(f.price).toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              })}
                            </div>
                          ))}
                        </div>
                      ) : (
                        `${Number(t.price_per_equipment ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} / equip.`
                      )}
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">{inclui}</TableCell>
                    <TableCell>
                      <RowActions
                        row={t}
                        onEdit={(r) => {
                          setEditing(r);
                          setOpen(true);
                        }}
                        onDelete={setToDelete}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <ContractTypeDialog open={open} onOpenChange={setOpen} editing={editing} />
      <ConfirmDelete
        open={!!toDelete}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
        title="Remover tipo de contrato?"
        body={
          <>
            <b>{toDelete?.name}</b> será removido.
          </>
        }
      />
    </div>
  );
}

function ContractTypeDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: ContractType | null;
}) {
  const qc = useQueryClient();
  const access = useCurrentModulePermissions();
  const readOnly = editing ? !access.edit : !access.create;
  const [form, setForm] = useState({
    name: "",
    description: "",
    billing_model: "hours_package" as BillingModel,
    default_hours_monthly: "0",
    default_monthly_value: "0",
    equipment_tiers: [{ min: "1", max: "10", price: "0" }] as {
      min: string;
      max: string;
      price: string;
    }[],
    service_items: [] as {
      reference: string;
      description: string;
      quantity: string;
      price: string;
    }[],
    includes_remote: false,
    includes_lab: false,
    includes_onsite: false,
  });

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof ctSchema>) => {
      const tenant_id = await getTenantId();
      const isHours = payload.billing_model === "hours_package";
      const isEquip = payload.billing_model === "per_equipment";
      const isService = payload.billing_model === "per_service";
      const servicesTotal = payload.service_items.reduce((s, it) => s + it.quantity * it.price, 0);
      const values = {
        name: payload.name,
        description: payload.description || null,
        billing_model: payload.billing_model,
        default_hours_monthly: isHours ? payload.default_hours_monthly : 0,
        default_monthly_value: isHours
          ? payload.default_monthly_value
          : isService
            ? servicesTotal
            : 0,
        equipment_min:
          isEquip && payload.equipment_tiers.length ? payload.equipment_tiers[0].min : null,
        equipment_max:
          isEquip && payload.equipment_tiers.length ? payload.equipment_tiers[0].max : null,
        price_per_equipment:
          isEquip && payload.equipment_tiers.length ? payload.equipment_tiers[0].price : null,
        equipment_tiers: isEquip ? payload.equipment_tiers : [],
        service_items: isService ? payload.service_items : [],
        includes_remote: payload.includes_remote,
        includes_lab: payload.includes_lab,
        includes_onsite: payload.includes_onsite,
      };
      if (editing) {
        const { error } = await supabase.from("contract_types").update(values).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("contract_types").insert({ ...values, tenant_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Salvo");
      qc.invalidateQueries({ queryKey: ["contract_types"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isHours = form.billing_model === "hours_package";
  const isService = form.billing_model === "per_service";

  useEffect(() => {
    if (!open) return;
    const tiers = editing?.equipment_tiers?.length
      ? editing.equipment_tiers.map((t) => ({
          min: String(t.min),
          max: String(t.max),
          price: String(t.price),
        }))
      : editing && editing.billing_model === "per_equipment"
        ? [
            {
              min: String(editing.equipment_min ?? 1),
              max: String(editing.equipment_max ?? 10),
              price: String(editing.price_per_equipment ?? 0),
            },
          ]
        : [{ min: "1", max: "10", price: "0" }];
    setForm({
      name: editing?.name ?? "",
      description: editing?.description ?? "",
      billing_model: editing?.billing_model ?? "hours_package",
      default_hours_monthly: String(editing?.default_hours_monthly ?? 0),
      default_monthly_value: String(editing?.default_monthly_value ?? 0),
      equipment_tiers: tiers,
      service_items: (editing?.service_items ?? []).map((s) => ({
        reference: s.reference ?? "",
        description: s.description ?? "",
        quantity: String(s.quantity ?? 0),
        price: String(s.price ?? 0),
      })),
      includes_remote: editing?.includes_remote ?? false,
      includes_lab: editing?.includes_lab ?? false,
      includes_onsite: editing?.includes_onsite ?? false,
    });
  }, [open, editing]);

  const updateTier = (i: number, patch: Partial<{ min: string; max: string; price: string }>) =>
    setForm((f) => ({
      ...f,
      equipment_tiers: f.equipment_tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)),
    }));
  const addTier = () =>
    setForm((f) => ({
      ...f,
      equipment_tiers: [...f.equipment_tiers, { min: "0", max: "0", price: "0" }],
    }));
  const removeTier = (i: number) =>
    setForm((f) => ({ ...f, equipment_tiers: f.equipment_tiers.filter((_, idx) => idx !== i) }));

  const updateService = (
    i: number,
    patch: Partial<{ reference: string; description: string; quantity: string; price: string }>,
  ) =>
    setForm((f) => ({
      ...f,
      service_items: f.service_items.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }));
  const addService = () =>
    setForm((f) => ({
      ...f,
      service_items: [
        ...f.service_items,
        { reference: "", description: "", quantity: "1", price: "0" },
      ],
    }));
  const removeService = (i: number) =>
    setForm((f) => ({ ...f, service_items: f.service_items.filter((_, idx) => idx !== i) }));
  const servicesTotal = form.service_items.reduce(
    (s, it) => s + Number(it.quantity || 0) * Number(it.price || 0),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <CrudDialogContent editing={!!editing} className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar" : "Novo"} tipo de contrato</DialogTitle>
        </DialogHeader>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const r = ctSchema.safeParse(form);
            if (!r.success) return toast.error(r.error.issues[0].message);
            save.mutate(r.data);
          }}
        >
          <div className="col-span-2">
            <Label>Nome *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label>Descrição</Label>
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="col-span-2">
            <Label>Modelo de cobrança *</Label>
            <Select
              value={form.billing_model}
              onValueChange={(v) => setForm({ ...form, billing_model: v as BillingModel })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hours_package">Pacote de horas contratadas</SelectItem>
                <SelectItem value="per_equipment">Por equipamento vinculado</SelectItem>
                <SelectItem value="per_service">Por serviço vinculado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isHours ? (
            <>
              <div>
                <Label>Horas contratadas</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.default_hours_monthly}
                  onChange={(e) => setForm({ ...form, default_hours_monthly: e.target.value })}
                />
              </div>
              <div>
                <Label>Valor do pacote (R$)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.default_monthly_value}
                  onChange={(e) => setForm({ ...form, default_monthly_value: e.target.value })}
                />
              </div>
            </>
          ) : isService ? (
            <div className="col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Serviços</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addService}
                  disabled={readOnly}
                >
                  <Plus className="h-3 w-3 mr-1" /> Adicionar serviços
                </Button>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <div className="grid grid-cols-[1fr_1.8fr_0.8fr_1.2fr_auto] gap-2 text-xs text-muted-foreground">
                  <span>Referência</span>
                  <span>Descrição</span>
                  <span>Quantidade</span>
                  <span>Valor unitário (R$)</span>
                  <span></span>
                </div>
                {!form.service_items.length && (
                  <div className="text-xs text-muted-foreground">Nenhum serviço adicionado.</div>
                )}
                {form.service_items.map((s, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_1.8fr_0.8fr_1.2fr_auto] gap-2 items-center"
                  >
                    <Input
                      value={s.reference}
                      onChange={(e) => updateService(i, { reference: e.target.value })}
                    />
                    <Input
                      value={s.description}
                      onChange={(e) => updateService(i, { description: e.target.value })}
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={s.quantity}
                      onChange={(e) => updateService(i, { quantity: e.target.value })}
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={s.price}
                      onChange={(e) => updateService(i, { price: e.target.value })}
                    />
                    <Button
                      type="button"
                      size="icon"
                      disabled={readOnly}
                      variant="ghost"
                      onClick={() => removeService(i)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="text-right text-xs">
                  Total:{" "}
                  <span className="font-medium">
                    {servicesTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Faixas de valor por equipamento</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addTier}
                  disabled={readOnly}
                >
                  <Plus className="h-3 w-3 mr-1" /> Adicionar faixa
                </Button>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <div className="grid grid-cols-[1fr_1fr_1.4fr_auto] gap-2 text-xs text-muted-foreground">
                  <span>De</span>
                  <span>Até</span>
                  <span>Valor unitário (R$)</span>
                  <span></span>
                </div>
                {form.equipment_tiers.map((t, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1.4fr_auto] gap-2 items-center">
                    <Input
                      type="number"
                      min={0}
                      value={t.min}
                      onChange={(e) => updateTier(i, { min: e.target.value })}
                    />
                    <Input
                      type="number"
                      min={0}
                      value={t.max}
                      onChange={(e) => updateTier(i, { max: e.target.value })}
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={t.price}
                      onChange={(e) => updateTier(i, { price: e.target.value })}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={readOnly || form.equipment_tiers.length <= 1}
                      onClick={() => removeTier(i)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="col-span-2 pt-2">
            <Label className="text-sm font-semibold">Inclui</Label>
            <div className="mt-2 space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between text-sm">
                <span>Suporte remoto</span>
                <Switch
                  checked={form.includes_remote}
                  onCheckedChange={(v) => setForm({ ...form, includes_remote: v })}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Laboratório</span>
                <Switch
                  checked={form.includes_lab}
                  onCheckedChange={(v) => setForm({ ...form, includes_lab: v })}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Visita técnica</span>
                <Switch
                  checked={form.includes_onsite}
                  onCheckedChange={(v) => setForm({ ...form, includes_onsite: v })}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </CrudDialogContent>
    </Dialog>
  );
}

/* ============================ SLAs ============================ */

type Sla = {
  id: string;
  name: string;
  priority: "low" | "medium" | "high" | "urgent" | null;
  first_response_minutes: number;
  resolution_minutes: number;
};
const slaSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório").max(100),
  priority: z.enum(["low", "medium", "high", "urgent"]).nullable(),
  first_response_minutes: z.coerce.number().int().min(1).max(100000),
  resolution_minutes: z.coerce.number().int().min(1).max(1000000),
});

const PRIORITY_LABEL: Record<NonNullable<Sla["priority"]>, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

function formatMinutes(m: number) {
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${r}m` : `${h}h`;
}

function SlasTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Sla | null>(null);
  const [toDelete, setToDelete] = useState<Sla | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["sla_policies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sla_policies")
        .select("*")
        .order("first_response_minutes");
      if (error) throw error;
      return data as Sla[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sla_policies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["sla_policies"] });
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <CrudHeader
        title="Políticas de SLA"
        onNew={() => {
          setEditing(null);
          setOpen(true);
        }}
      />
      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>
      ) : !data?.length ? (
        <EmptyStub
          title="Nenhuma SLA"
          message="Defina tempos de primeira resposta e resolução por prioridade."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Prioridade</TableHead>
                <TableHead>1ª resposta</TableHead>
                <TableHead>Resolução</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>
                    {s.priority ? (
                      <Badge variant="outline">{PRIORITY_LABEL[s.priority]}</Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{formatMinutes(s.first_response_minutes)}</TableCell>
                  <TableCell>{formatMinutes(s.resolution_minutes)}</TableCell>
                  <TableCell>
                    <RowActions
                      row={s}
                      onEdit={(r) => {
                        setEditing(r);
                        setOpen(true);
                      }}
                      onDelete={setToDelete}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <SlaDialog open={open} onOpenChange={setOpen} editing={editing} />
      <ConfirmDelete
        open={!!toDelete}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
        title="Remover SLA?"
        body={
          <>
            A política <b>{toDelete?.name}</b> será removida.
          </>
        }
      />
    </div>
  );
}

function SlaDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Sla | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    priority: "" as string,
    first_response_minutes: "60",
    resolution_minutes: "480",
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      name: editing?.name ?? "",
      priority: editing?.priority ?? "",
      first_response_minutes: String(editing?.first_response_minutes ?? 60),
      resolution_minutes: String(editing?.resolution_minutes ?? 480),
    });
  }, [open, editing]);

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof slaSchema>) => {
      const tenant_id = await getTenantId();
      const values = {
        name: payload.name,
        priority: payload.priority,
        first_response_minutes: payload.first_response_minutes,
        resolution_minutes: payload.resolution_minutes,
      };
      if (editing) {
        const { error } = await supabase.from("sla_policies").update(values).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("sla_policies").insert({ ...values, tenant_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Salvo");
      qc.invalidateQueries({ queryKey: ["sla_policies"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <CrudDialogContent editing={!!editing}>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar" : "Nova"} política de SLA</DialogTitle>
        </DialogHeader>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const r = slaSchema.safeParse({
              name: form.name,
              priority: form.priority || null,
              first_response_minutes: form.first_response_minutes,
              resolution_minutes: form.resolution_minutes,
            });
            if (!r.success) return toast.error(r.error.issues[0].message);
            save.mutate(r.data);
          }}
        >
          <div className="col-span-2">
            <Label>Nome *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label>Prioridade alvo</Label>
            <Select
              value={form.priority || "none"}
              onValueChange={(v) => setForm({ ...form, priority: v === "none" ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Qualquer —</SelectItem>
                <SelectItem value="low">Baixa</SelectItem>
                <SelectItem value="medium">Média</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="urgent">Urgente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>1ª resposta (minutos) *</Label>
            <Input
              type="number"
              min={1}
              value={form.first_response_minutes}
              onChange={(e) => setForm({ ...form, first_response_minutes: e.target.value })}
            />
          </div>
          <div>
            <Label>Resolução (minutos) *</Label>
            <Input
              type="number"
              min={1}
              value={form.resolution_minutes}
              onChange={(e) => setForm({ ...form, resolution_minutes: e.target.value })}
            />
          </div>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </CrudDialogContent>
    </Dialog>
  );
}

/* ============================ CANNED RESPONSES ============================ */

type Canned = { id: string; title: string; body: string };
const cannedSchema = z.object({
  title: z.string().trim().min(1, "Título obrigatório").max(150),
  body: z.string().trim().min(1, "Conteúdo obrigatório").max(5000),
});

function CannedTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Canned | null>(null);
  const [toDelete, setToDelete] = useState<Canned | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["canned_responses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("canned_responses").select("*").order("title");
      if (error) throw error;
      return data as Canned[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("canned_responses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["canned_responses"] });
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <CrudHeader
        title="Respostas padrão"
        onNew={() => {
          setEditing(null);
          setOpen(true);
        }}
      />
      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>
      ) : !data?.length ? (
        <EmptyStub
          title="Nenhuma resposta padrão"
          message="Acelere atendimentos com modelos reutilizáveis (saudação, encerramento, pedido de logs)."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Prévia</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.title}</TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-md">
                    {c.body.slice(0, 120)}
                    {c.body.length > 120 ? "…" : ""}
                  </TableCell>
                  <TableCell>
                    <RowActions
                      row={c}
                      onEdit={(r) => {
                        setEditing(r);
                        setOpen(true);
                      }}
                      onDelete={setToDelete}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <CannedDialog open={open} onOpenChange={setOpen} editing={editing} />
      <ConfirmDelete
        open={!!toDelete}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
        title="Remover resposta?"
        body={
          <>
            <b>{toDelete?.title}</b> será removida.
          </>
        }
      />
    </div>
  );
}

function CannedDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Canned | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", body: "" });

  useEffect(() => {
    if (!open) return;
    setForm({ title: editing?.title ?? "", body: editing?.body ?? "" });
  }, [open, editing]);

  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof cannedSchema>) => {
      const tenant_id = await getTenantId();
      const values = { title: payload.title, body: payload.body };
      if (editing) {
        const { error } = await supabase
          .from("canned_responses")
          .update(values)
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("canned_responses")
          .insert({ ...values, tenant_id, created_by: getCurrentUserId() });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Salvo");
      qc.invalidateQueries({ queryKey: ["canned_responses"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <CrudDialogContent
        editing={!!editing}
        className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{editing ? "Editar" : "Nova"} resposta padrão</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const r = cannedSchema.safeParse(form);
            if (!r.success) return toast.error(r.error.issues[0].message);
            save.mutate(r.data);
          }}
        >
          <div>
            <Label>Título *</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div>
            <Label>Conteúdo *</Label>
            <Textarea
              rows={8}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </CrudDialogContent>
    </Dialog>
  );
}

/* ============================ STICKERS ============================ */

type StickerRow = { id: string; name: string; storage_path: string };

function StickersTab() {
  const access = useModulePermissions("figurinhas");
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState<StickerRow | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["stickers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stickers")
        .select("id,name,storage_path")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as StickerRow[];
      const withUrls = await Promise.all(
        rows.map(async (r) => {
          const { data: s } = await supabase.storage
            .from("ticket-attachments")
            .createSignedUrl(r.storage_path, 60 * 60);
          return { ...r, url: s?.signedUrl ?? "" };
        }),
      );
      return withUrls;
    },
  });

  const onUpload = async (files: FileList | null) => {
    if (!access.create) return;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const { data: tid, error: tidErr } = await supabase.rpc("current_tenant_id");
      if (tidErr || !tid) throw new Error(tidErr?.message ?? "Tenant não encontrado");
      const tenant_id = tid as string;
      const authorId = getCurrentUserId();
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          toast.error(`${file.name}: apenas imagens`);
          continue;
        }
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
        const path = `${tenant_id}/_stickers/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safe}`;
        const { error: upErr } = await supabase.storage
          .from("ticket-attachments")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        const { error: insErr } = await supabase.from("stickers").insert({
          tenant_id,
          name: file.name.replace(/\.[^.]+$/, ""),
          storage_path: path,
          created_by: authorId,
        });
        if (insErr) throw insErr;
      }
      toast.success("Figurinhas adicionadas");
      qc.invalidateQueries({ queryKey: ["stickers"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const del = useMutation({
    mutationFn: async (row: StickerRow) => {
      if (!access.delete) throw new Error("Sem permissão para excluir figurinhas");
      await supabase.storage.from("ticket-attachments").remove([row.storage_path]);
      const { error } = await supabase.from("stickers").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removida");
      qc.invalidateQueries({ queryKey: ["stickers"] });
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Galeria de figurinhas</h2>
          <p className="text-xs text-muted-foreground">
            Imagens reutilizáveis para envio no WhatsApp (recomendado .webp 512×512).
          </p>
        </div>
        {access.create && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                onUpload(e.target.files);
                e.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Enviando…" : "Adicionar"}
            </Button>
          </div>
        )}
      </div>
      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>
      ) : !data?.length ? (
        <EmptyStub
          title="Nenhuma figurinha"
          message="Adicione imagens .webp para reutilizar em conversas."
        />
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {data.map((s) => (
            <Card key={s.id} className="group relative aspect-square overflow-hidden p-2">
              <img src={s.url} alt={s.name} className="h-full w-full object-contain" />
              {access.delete && (
                <button
                  onClick={() => setToDelete(s)}
                  className="absolute right-1 top-1 hidden rounded bg-destructive/90 p-1 text-destructive-foreground group-hover:block"
                  title="Remover"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
              <div className="absolute inset-x-0 bottom-0 truncate bg-background/80 px-1 text-[10px] text-muted-foreground">
                {s.name}
              </div>
            </Card>
          ))}
        </div>
      )}
      {access.delete && (
        <ConfirmDelete
          open={!!toDelete}
          onCancel={() => setToDelete(null)}
          onConfirm={() => toDelete && del.mutate(toDelete)}
          title="Remover figurinha?"
          body={
            <>
              <b>{toDelete?.name}</b> será removida.
            </>
          }
        />
      )}
    </div>
  );
}

/* ============================ CHANNELS ============================ */

const CHANNELS = [
  {
    key: "email",
    label: "E-mail",
    icon: Mail,
    desc: "Receba tickets por e-mail via encaminhamento ou IMAP.",
    status: "Ativo",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    desc: "Integração com UAZAPI: converse pelo WhatsApp direto no ticket.",
    status: "Ativo",
  },
  {
    key: "chat",
    label: "Chat",
    icon: MessageSquare,
    desc: "Widget de chat embarcável no site do cliente.",
    status: "Em breve",
  },
  {
    key: "portal",
    label: "Portal do Cliente",
    icon: Globe,
    desc: "Auto-atendimento e abertura de chamados pelos contatos.",
    status: "Ativo",
  },
  {
    key: "manual",
    label: "Manual",
    icon: Hand,
    desc: "Tickets criados pelos próprios agentes.",
    status: "Ativo",
  },
] as const;

type ChannelConfig = {
  defaultPriority: "low" | "medium" | "high" | "urgent";
  defaultStatus: "open" | "pending";
  requireContract: boolean;
  signature: string;
};

const CHANNEL_DEFAULTS: ChannelConfig = {
  defaultPriority: "medium",
  defaultStatus: "open",
  requireContract: true,
  signature: "",
};

function loadChannelConfig(key: string): ChannelConfig {
  if (typeof window === "undefined") return CHANNEL_DEFAULTS;
  try {
    const raw = localStorage.getItem(`apticket:channel:${key}`);
    return raw ? { ...CHANNEL_DEFAULTS, ...JSON.parse(raw) } : CHANNEL_DEFAULTS;
  } catch {
    return CHANNEL_DEFAULTS;
  }
}

function ChannelsTab() {
  const access = useModulePermissions("canais");
  const [configuring, setConfiguring] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Canais de entrada</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {CHANNELS.map((c) => {
          const Icon = c.icon;
          const active = c.status === "Ativo";
          return (
            <Card key={c.key} className="p-4 flex items-start gap-3">
              <div className="rounded-md bg-primary/10 text-primary p-2">
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">{c.label}</div>
                  <Badge variant={active ? "default" : "outline"}>{c.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{c.desc}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  disabled={!active}
                  onClick={() => active && setConfiguring(c.key)}
                >
                  {active ? (access.edit ? "Configurar" : "Visualizar") : "Conectar"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Integrações com e-mail e WhatsApp exigem credenciais externas e serão habilitadas na próxima
        fase.
      </p>
      {configuring && (
        <ChannelConfigDialog
          channelKey={configuring}
          channelLabel={CHANNELS.find((c) => c.key === configuring)?.label ?? ""}
          readOnly={!access.edit}
          onClose={() => setConfiguring(null)}
        />
      )}
    </div>
  );
}

function ChannelConfigDialog({
  channelKey,
  channelLabel,
  onClose,
  readOnly,
}: {
  channelKey: string;
  channelLabel: string;
  onClose: () => void;
  readOnly: boolean;
}) {
  const [cfg, setCfg] = useState<ChannelConfig>(() => loadChannelConfig(channelKey));

  function save() {
    if (readOnly) return;
    try {
      localStorage.setItem(`apticket:channel:${channelKey}`, JSON.stringify(cfg));
      toast.success(`Canal ${channelLabel} configurado`);
      onClose();
    } catch {
      toast.error("Não foi possível salvar a configuração");
    }
  }

  const generalSection = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Prioridade padrão</Label>
          <Select
            value={cfg.defaultPriority}
            onValueChange={(v) =>
              setCfg({ ...cfg, defaultPriority: v as ChannelConfig["defaultPriority"] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Baixa</SelectItem>
              <SelectItem value="medium">Média</SelectItem>
              <SelectItem value="high">Alta</SelectItem>
              <SelectItem value="urgent">Urgente</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Status inicial</Label>
          <Select
            value={cfg.defaultStatus}
            onValueChange={(v) =>
              setCfg({ ...cfg, defaultStatus: v as ChannelConfig["defaultStatus"] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Aberto</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <div className="text-sm font-medium">Exigir contrato ativo</div>
          <div className="text-xs text-muted-foreground">
            Bloqueia abertura sem contrato vigente do cliente.
          </div>
        </div>
        <Switch
          checked={cfg.requireContract}
          onCheckedChange={(v) => setCfg({ ...cfg, requireContract: v })}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Assinatura padrão</Label>
        <Textarea
          rows={3}
          value={cfg.signature}
          onChange={(e) => setCfg({ ...cfg, signature: e.target.value })}
          placeholder="Atenciosamente, equipe de Suporte"
        />
      </div>
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <ReadOnlyProvider readOnly={readOnly}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw]">
          <ReadOnlyNotice show={readOnly} />
          <DialogHeader>
            <DialogTitle>Configurar canal — {channelLabel}</DialogTitle>
          </DialogHeader>
          {channelKey === "email" ? (
            <EmailImapConfig onSaved={onClose} readOnly={readOnly} />
          ) : channelKey === "whatsapp" ? (
            <WhatsAppConfig onSaved={onClose} readOnly={readOnly} />
          ) : (
            generalSection
          )}
          {channelKey !== "whatsapp" && channelKey !== "email" && (
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              {!readOnly && <Button onClick={save}>Salvar</Button>}
            </DialogFooter>
          )}
        </DialogContent>
      </ReadOnlyProvider>
    </Dialog>
  );
}

/* ============================ Confirm delete ============================ */

function ConfirmDelete({
  open,
  onCancel,
  onConfirm,
  title,
  body,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  body: React.ReactNode;
}) {
  const access = useCurrentModulePermissions();
  if (!access.delete) return null;
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Remover</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ============================ WhatsApp (UAZAPI) ============================ */

type WhatsAppSettings = {
  whatsapp_enabled: boolean;
  whatsapp_uazapi_base_url: string;
  whatsapp_uazapi_token: string;
  whatsapp_uazapi_instance: string;
  whatsapp_connected_number: string | null;
};

function WhatsAppConfig({ onSaved, readOnly }: { onSaved: () => void; readOnly: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<WhatsAppSettings>({
    whatsapp_enabled: false,
    whatsapp_uazapi_base_url: "",
    whatsapp_uazapi_token: "",
    whatsapp_uazapi_instance: "",
    whatsapp_connected_number: null,
  });
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [webhookTenantId, setWebhookTenantId] = useState<string | null>(null);
  const qcWa = useQueryClient();

  // Webhook expõe a API por trás do proxy same-origin do próprio app — não
  // depende mais de domínio de preview/publicado de nenhuma plataforma de
  // hospedagem específica. O :tenantId aqui precisa ser o UUID real — essa
  // rota é pública (sem JWT), então o backend não tem como resolver "me".
  const webhookUrl =
    typeof window !== "undefined" && webhookSecret && webhookTenantId
      ? `${window.location.origin}/backend/webhooks/whatsapp/${webhookTenantId}?secret=${encodeURIComponent(webhookSecret)}`
      : "";

  // Enquanto o QR tá visível, confere status a cada poucos segundos e some
  // sozinho quando conectar.
  useEffect(() => {
    if (!qrCode) return;
    let stopped = false;
    const interval = setInterval(async () => {
      try {
        const r = await backendClient.get<{ connected: boolean; number: string | null }>(
          "/channels/whatsapp/instances/me/status",
        );
        if (stopped) return;
        if (r.connected) {
          setQrCode(null);
          toast.success(`WhatsApp conectado${r.number ? `: ${r.number}` : ""}`);
          await qcWa.invalidateQueries({ queryKey: ["tenant-whatsapp"] });
          clearInterval(interval);
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [qrCode, qcWa]);

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-whatsapp"],
    queryFn: async () => {
      const [instance] = await backendClient.get<WhatsappInstanceDto[]>(
        "/channels/whatsapp/instances",
      );
      return instance ?? null;
    },
  });

  useEffect(() => {
    if (data) {
      setForm({
        whatsapp_enabled: data.status !== "disconnected" || !!data.baseUrl,
        whatsapp_uazapi_base_url: data.baseUrl ?? "",
        whatsapp_uazapi_token: "",
        whatsapp_uazapi_instance: data.instanceName ?? "",
        whatsapp_connected_number: data.connectedNumber,
      });
      setWebhookSecret(data.webhookSecret);
      setWebhookTenantId(data.tenantId);
    }
  }, [data]);
  const hasSavedToken = !!data?.baseUrl;

  const save = useMutation({
    mutationFn: () => {
      if (readOnly) throw new Error("Sem permissão para editar canais");
      return backendClient.post<WhatsappInstanceDto>("/channels/whatsapp/instances", {
        baseUrl: form.whatsapp_uazapi_base_url.trim().replace(/\/+$/, ""),
        token: form.whatsapp_uazapi_token.trim() || undefined,
        instanceName: form.whatsapp_uazapi_instance.trim() || undefined,
        enabled: form.whatsapp_enabled,
      });
    },
    onSuccess: () => {
      toast.success("WhatsApp configurado");
      qc.invalidateQueries({ queryKey: ["tenant-whatsapp"] });
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function test() {
    if (readOnly) return;
    setTesting(true);
    try {
      const r = await backendClient.get<{
        ok: boolean;
        connected: boolean;
        number: string | null;
      }>("/channels/whatsapp/instances/me/status");
      if (r.connected) {
        toast.success(`Instância conectada${r.number ? ` — ${r.number}` : ""}`);
      } else if (r.ok) {
        toast.warning("Credenciais válidas, mas a instância não está conectada. Escaneie o QR.");
      } else {
        // `ok: false` aqui é a uazapi inalcançável (URL errada, instância fora do
        // ar, timeout) — não confundir com "credenciais válidas" sem checar `ok`.
        toast.error("Não foi possível conectar à uazapi. Confira a URL base.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao testar");
    } finally {
      setTesting(false);
    }
  }

  async function connect() {
    if (readOnly) return;
    setConnecting(true);
    setQrCode(null);
    try {
      const r = await backendClient.get<{ connected: boolean; qrcode: string | null }>(
        "/channels/whatsapp/instances/me/qrcode",
      );
      if (r.connected) toast.success("Instância já conectada");
      else if (r.qrcode) {
        setQrCode(r.qrcode);
        toast.info("Escaneie o QR code no WhatsApp do celular");
      } else toast.warning("Sem QR retornado — verifique a uazapi");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao conectar");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    if (readOnly) return;
    try {
      await backendClient.post("/channels/whatsapp/instances/me/disconnect");
      setForm((f) => ({ ...f, whatsapp_connected_number: null }));
      toast.success("Instância desconectada");
      qc.invalidateQueries({ queryKey: ["tenant-whatsapp"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao desconectar");
    }
  }

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Carregando…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <div className="text-sm font-medium">Habilitar WhatsApp</div>
          <div className="text-xs text-muted-foreground">
            Ativa recebimento e envio de mensagens via UAZAPI.
          </div>
        </div>
        <Switch
          checked={form.whatsapp_enabled}
          onCheckedChange={(v) => setForm({ ...form, whatsapp_enabled: v })}
        />
      </div>

      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label>URL base da UAZAPI *</Label>
          <Input
            value={form.whatsapp_uazapi_base_url}
            onChange={(e) => setForm({ ...form, whatsapp_uazapi_base_url: e.target.value })}
            placeholder="https://sua-instancia.uazapi.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label>{hasSavedToken ? "Token da instância" : "Token da instância *"}</Label>
          <Input
            type="password"
            value={form.whatsapp_uazapi_token}
            onChange={(e) => setForm({ ...form, whatsapp_uazapi_token: e.target.value })}
            placeholder={
              hasSavedToken ? "Deixe em branco para manter o atual" : "Token gerado na UAZAPI"
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label>Nome da instância (opcional)</Label>
          <Input
            value={form.whatsapp_uazapi_instance}
            onChange={(e) => setForm({ ...form, whatsapp_uazapi_instance: e.target.value })}
            placeholder="minha-instancia"
          />
        </div>
        {form.whatsapp_connected_number && (
          <div className="text-xs text-muted-foreground">
            Número conectado:{" "}
            <span className="font-medium text-foreground">
              {maskWhatsappPhone(form.whatsapp_connected_number)}
            </span>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testing || readOnly}
            onClick={test}
          >
            {testing ? "Testando…" : "Testar conexão"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              connecting ||
              readOnly ||
              !form.whatsapp_uazapi_base_url ||
              (!hasSavedToken && !form.whatsapp_uazapi_token)
            }
            onClick={connect}
          >
            {connecting ? "Gerando QR…" : "Conectar / Gerar QR"}
          </Button>
          {form.whatsapp_connected_number && !readOnly && (
            <Button type="button" variant="ghost" size="sm" onClick={disconnect}>
              Desconectar
            </Button>
          )}
        </div>
        {qrCode && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-3">
            <img src={qrCode} alt="QR WhatsApp" className="h-56 w-56" />
            <p className="text-xs text-muted-foreground">
              Abra WhatsApp → Aparelhos conectados → Conectar um aparelho e aponte a câmera.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <div className="text-sm font-semibold">Webhook (UAZAPI → APTicket)</div>
        <p className="text-xs text-muted-foreground">
          Segredo gerado automaticamente no primeiro salvamento — já embutido na URL abaixo, nenhuma
          configuração extra.
        </p>
        {webhookUrl ? (
          <div className="space-y-1.5">
            <Label>URL do webhook</Label>
            <Input readOnly value={webhookUrl} onFocus={(e) => e.currentTarget.select()} />
            <p className="text-xs text-muted-foreground">
              Cadastre esta URL na configuração de webhook da sua instância UAZAPI.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Salve a configuração pra gerar a URL.</p>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onSaved}>
          Cancelar
        </Button>
        {!readOnly && (
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ============================ E-mail (IMAP) ============================ */

type EmailSettings = {
  email_enabled: boolean;
  email_inbox_address: string;
  email_imap_host: string;
  email_imap_port: string;
  email_imap_user: string;
  email_imap_password: string;
  email_imap_secure: boolean;
  email_poll_interval_minutes: string;
  email_smtp_host: string;
  email_smtp_port: string;
  email_smtp_secure: boolean;
};

const POLL_INTERVAL_OPTIONS = [1, 2, 5, 10, 15, 30, 60];

function EmailImapConfig({ onSaved, readOnly }: { onSaved: () => void; readOnly: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<EmailSettings>({
    email_enabled: false,
    email_inbox_address: "",
    email_imap_host: "",
    email_imap_port: "993",
    email_imap_user: "",
    email_imap_password: "",
    email_imap_secure: true,
    email_poll_interval_minutes: "5",
    email_smtp_host: "",
    email_smtp_port: "587",
    email_smtp_secure: false,
  });
  const [testing, setTesting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-email-imap"],
    queryFn: async () => {
      const [account] = await backendClient.get<EmailAccountDto[]>("/channels/email/accounts");
      return account ?? null;
    },
  });
  // Senha nunca volta em claro da API (fica criptografada no banco) — o
  // campo sempre carrega vazio; salvar sem digitar mantém a que já tá lá
  // (ver UpsertEmailAccountDto.imapPassword no backend).
  const hasSavedPassword = !!data?.imapHost;

  useEffect(() => {
    if (data) {
      setForm({
        email_enabled: data.enabled,
        email_inbox_address: data.inboxAddress ?? "",
        email_imap_host: data.imapHost ?? "",
        email_imap_port: String(data.imapPort ?? 993),
        email_imap_user: data.imapUser ?? "",
        email_imap_password: "",
        email_imap_secure: data.imapSecure,
        email_poll_interval_minutes: String(data.pollIntervalMinutes ?? 5),
        email_smtp_host: data.smtpHost ?? "",
        email_smtp_port: String(data.smtpPort ?? 587),
        email_smtp_secure: data.smtpSecure,
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (readOnly) throw new Error("Sem permissão para editar canais");
      const port = Number(form.email_imap_port);
      const interval = Number(form.email_poll_interval_minutes);
      const smtpPort = Number(form.email_smtp_port);
      // POST na coleção (sem /:id) — o controller faz upsert, não existe
      // rota POST /accounts/:id (só PATCH/test-connection/sync/send usam
      // :id, aí sim como "me").
      await backendClient.post("/channels/email/accounts", {
        inboxAddress: form.email_inbox_address.trim() || undefined,
        imapHost: form.email_imap_host.trim(),
        imapPort: Number.isInteger(port) && port > 0 ? port : 993,
        imapUser: form.email_imap_user.trim(),
        imapPassword: form.email_imap_password || undefined,
        imapSecure: form.email_imap_secure,
        smtpHost: form.email_smtp_host.trim(),
        smtpPort: Number.isInteger(smtpPort) && smtpPort > 0 ? smtpPort : 587,
        smtpSecure: form.email_smtp_secure,
        pollIntervalMinutes:
          Number.isInteger(interval) && interval >= 1 && interval <= 60 ? interval : 5,
        enabled: form.email_enabled,
      });
    },
    onSuccess: () => {
      toast.success("E-mail configurado");
      qc.invalidateQueries({ queryKey: ["tenant-email-imap"] });
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function test() {
    if (readOnly) return;
    if (
      !form.email_imap_host ||
      !form.email_imap_user ||
      (!form.email_imap_password && !hasSavedPassword)
    ) {
      toast.error("Informe servidor, usuário e senha.");
      return;
    }
    setTesting(true);
    try {
      const r = await backendClient.post<{ imapOk: boolean; error?: string }>(
        "/channels/email/accounts/me/test-connection",
        {
          imapHost: form.email_imap_host,
          imapPort: Number(form.email_imap_port) || 993,
          imapUser: form.email_imap_user,
          imapPassword: form.email_imap_password || undefined,
          imapSecure: form.email_imap_secure,
        },
      );
      if (r.imapOk) toast.success("Conectado com sucesso.");
      else toast.error(r.error ?? "Falha ao conectar.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao testar");
    } finally {
      setTesting(false);
    }
  }

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Carregando…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <div className="text-sm font-medium">Habilitar e-mail (IMAP)</div>
          <div className="text-xs text-muted-foreground">
            Verifica a caixa a cada poucos minutos e abre chamados para contatos com contrato ativo.
          </div>
        </div>
        <Switch
          checked={form.email_enabled}
          onCheckedChange={(v) => setForm({ ...form, email_enabled: v })}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Intervalo de verificação automática</Label>
        <Select
          value={form.email_poll_interval_minutes}
          onValueChange={(v) => setForm({ ...form, email_poll_interval_minutes: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POLL_INTERVAL_OPTIONS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                A cada {m} minuto{m > 1 ? "s" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          De quanto em quanto tempo o sistema busca e-mails novos automaticamente. O botão
          &quot;Sincronizar agora&quot; da Fila de E-mail sempre roda na hora, sem esperar esse
          intervalo.
        </p>
      </div>

      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label>Endereço da caixa</Label>
          <Input
            type="email"
            value={form.email_inbox_address}
            onChange={(e) => setForm({ ...form, email_inbox_address: e.target.value })}
            placeholder="suporte@suaempresa.com"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>Servidor IMAP *</Label>
            <Input
              value={form.email_imap_host}
              onChange={(e) => setForm({ ...form, email_imap_host: e.target.value })}
              placeholder="imap.suaempresa.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Porta</Label>
            <Input
              value={form.email_imap_port}
              onChange={(e) => setForm({ ...form, email_imap_port: e.target.value })}
              placeholder="993"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label className="text-sm">SSL/TLS</Label>
            <Switch
              checked={form.email_imap_secure}
              onCheckedChange={(v) => setForm({ ...form, email_imap_secure: v })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Usuário *</Label>
            <Input
              value={form.email_imap_user}
              onChange={(e) => setForm({ ...form, email_imap_user: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{hasSavedPassword ? "Senha" : "Senha *"}</Label>
            <Input
              type="password"
              value={form.email_imap_password}
              onChange={(e) => setForm({ ...form, email_imap_password: e.target.value })}
              placeholder={hasSavedPassword ? "Deixe em branco para manter a atual" : ""}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testing || readOnly}
            onClick={test}
          >
            {testing ? "Testando…" : "Testar conexão"}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
        Um chamado só é aberto se o remetente já existir como contato e a empresa dele tiver
        contrato ativo — a mensagem é ignorada silenciosamente caso contrário.
      </p>

      <div className="space-y-3 rounded-md border p-3">
        <div>
          <div className="text-sm font-semibold">Envio (SMTP)</div>
          <p className="text-xs text-muted-foreground">
            Usado para enviar as respostas do agente aos tickets desse canal. Usa o mesmo
            usuário/senha do IMAP acima — normalmente a mesma caixa de e-mail.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>Servidor SMTP</Label>
            <Input
              value={form.email_smtp_host}
              onChange={(e) => setForm({ ...form, email_smtp_host: e.target.value })}
              placeholder="smtp.suaempresa.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Porta</Label>
            <Input
              value={form.email_smtp_port}
              onChange={(e) => setForm({ ...form, email_smtp_port: e.target.value })}
              placeholder="587"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label className="text-sm">SSL/TLS</Label>
            <Switch
              checked={form.email_smtp_secure}
              onCheckedChange={(v) => setForm({ ...form, email_smtp_secure: v })}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Porta 465 costuma exigir SSL/TLS ligado; porta 587 costuma ser desligado (STARTTLS).
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onSaved}>
          Cancelar
        </Button>
        {!readOnly && (
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        )}
      </div>
    </div>
  );
}
