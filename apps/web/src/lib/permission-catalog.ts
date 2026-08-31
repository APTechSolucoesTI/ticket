// Metadados do catálogo de permissões v2 - só rótulo/ordem/hierarquia
// (dados de verdade vêm do banco via listPermissionsCatalog). Usado nas
// telas de Papéis/Permissões (matriz) e pra gate de menu/rota em toda a
// aplicação (sidebar, abas de Configurações).
export interface ModuleMeta {
  key: string;
  label: string;
  actions: readonly string[];
  /** Se setado, esse módulo só é acessível/visível quando o pai também tem `view`. */
  parent?: string;
}

export const MODULE_ORDER: readonly ModuleMeta[] = [
  { key: "tickets", label: "Tickets", actions: ["view", "create", "edit", "delete"] },
  { key: "fila_whatsapp", label: "Fila WhatsApp", actions: ["view", "create", "edit", "delete"] },
  { key: "fila_email", label: "Fila E-mail", actions: ["view", "create", "edit", "delete"] },
  { key: "clientes", label: "Clientes", actions: ["view", "create", "edit", "delete"] },
  { key: "contatos", label: "Contatos", actions: ["view", "create", "edit", "delete"] },
  { key: "equipamentos", label: "Equipamentos", actions: ["view", "create", "edit", "delete"] },
  { key: "contratos", label: "Contratos", actions: ["view", "create", "edit", "delete"] },
  {
    key: "base_conhecimento",
    label: "Base de Conhecimento",
    actions: ["view", "create", "edit", "delete"],
  },
  { key: "relatorios", label: "Relatórios", actions: ["view"] },
  { key: "financeiro", label: "Financeiro", actions: ["view", "edit"] },
  { key: "configuracoes", label: "Configurações", actions: ["view", "edit"] },
  { key: "empresa", label: "Empresa", actions: ["view", "edit"], parent: "configuracoes" },
  {
    key: "usuarios",
    label: "Usuários",
    actions: ["view", "create", "edit", "delete"],
    parent: "configuracoes",
  },
  {
    key: "papeis",
    label: "Papéis",
    actions: ["view", "create", "edit", "delete"],
    parent: "configuracoes",
  },
  {
    key: "permissoes",
    label: "Permissões",
    actions: ["view", "create", "edit", "delete"],
    parent: "configuracoes",
  },
  {
    key: "departamentos",
    label: "Departamentos",
    actions: ["view", "create", "edit", "delete"],
    parent: "configuracoes",
  },
  {
    key: "familia_servicos",
    label: "Família de Serviços",
    actions: ["view", "create", "edit", "delete"],
    parent: "configuracoes",
  },
  {
    key: "servicos_prestados",
    label: "Serviços Prestados",
    actions: ["view", "create", "edit", "delete"],
    parent: "configuracoes",
  },
  {
    key: "tipos_contrato",
    label: "Tipos de Contrato",
    actions: ["view", "create", "edit", "delete"],
    parent: "configuracoes",
  },
  {
    key: "slas",
    label: "SLAs",
    actions: ["view", "create", "edit", "delete"],
    parent: "configuracoes",
  },
  {
    key: "respostas_padrao",
    label: "Respostas Padrão",
    actions: ["view", "create", "edit", "delete"],
    parent: "configuracoes",
  },
  {
    key: "figurinhas",
    label: "Figurinhas",
    actions: ["view", "create", "edit", "delete"],
    parent: "configuracoes",
  },
  { key: "canais", label: "Canais", actions: ["view", "edit"], parent: "configuracoes" },
] as const;

export const ACTION_LABELS: Record<string, string> = {
  view: "Visualiza",
  create: "Cria",
  edit: "Edita",
  delete: "Exclui",
};

/** Prefixo de rota -> módulo que precisa de `view` pra acessar. Usado no
 * guard de rota (route.tsx) - checagem real, não só esconder link da
 * sidebar. Ordem importa: primeiro match (mais específico) vence. */
export const ROUTE_MODULE_MAP: readonly { prefix: string; module: string }[] = [
  { prefix: "/tickets", module: "tickets" },
  { prefix: "/whatsapp-pending", module: "fila_whatsapp" },
  { prefix: "/email-pending", module: "fila_email" },
  { prefix: "/customers", module: "clientes" },
  { prefix: "/contacts", module: "contatos" },
  { prefix: "/equipments", module: "equipamentos" },
  { prefix: "/contracts", module: "contratos" },
  { prefix: "/kb", module: "base_conhecimento" },
  { prefix: "/reports", module: "relatorios" },
  { prefix: "/finance", module: "financeiro" },
  { prefix: "/settings", module: "configuracoes" },
];

/** null = rota livre (não precisa de permissão pra entrar, ex: /dashboard). */
export function moduleForRoute(pathname: string): string | null {
  const hit = ROUTE_MODULE_MAP.find(
    (r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"),
  );
  return hit?.module ?? null;
}

export function moduleLabel(key: string): string {
  return MODULE_ORDER.find((m) => m.key === key)?.label ?? key;
}

export function moduleMeta(key: string): ModuleMeta | undefined {
  return MODULE_ORDER.find((m) => m.key === key);
}

export function childModules(parentKey: string): ModuleMeta[] {
  return MODULE_ORDER.filter((m) => m.parent === parentKey);
}

/** true se módulo (ou o pai dele) está sem `view` - trava/esconde tudo dentro. */
export function isModuleLocked(key: string, hasView: (module: string) => boolean): boolean {
  const meta = moduleMeta(key);
  if (!meta) return false;
  if (meta.parent && !hasView(meta.parent)) return true;
  return false;
}
