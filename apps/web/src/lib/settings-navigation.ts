export const SETTINGS_SECTIONS = {
  company: {
    path: "/settings/company",
    module: "empresa",
    label: "Empresa",
    description: "Dados cadastrais, identidade e informações da empresa.",
  },
  financial: {
    path: "/settings/financial/preferences",
    module: "configuracoes",
    label: "Preferências financeiras",
    description: "Aprovações de pagamentos e regras de cobrança.",
  },
  "operating-companies": {
    path: "/settings/financial/operating-companies",
    module: "empresa_operadora",
    label: "Empresa Operadora",
    description: "Empresas responsáveis pelas operações financeiras.",
  },
  inter: {
    path: "/settings/financial/banking/inter",
    module: "financeiro_bancos",
    label: "Banco Inter",
    description: "Credenciais e integração bancária por empresa operadora.",
    requires: ["financeiro", "empresa_operadora"],
  },
  departments: {
    path: "/settings/catalogs/departments",
    module: "departamentos",
    label: "Departamentos",
    description: "Equipes e organização do atendimento.",
  },
  "service-families": {
    path: "/settings/catalogs/service-families",
    module: "familia_servicos",
    label: "Família de Serviços",
    description: "Agrupamentos dos serviços oferecidos.",
  },
  "provided-services": {
    path: "/settings/catalogs/provided-services",
    module: "servicos_prestados",
    label: "Serviços Prestados",
    description: "Catálogo de serviços e seus valores.",
  },
  "contract-types": {
    path: "/settings/catalogs/contract-types",
    module: "tipos_contrato",
    label: "Tipos de Contratos",
    description: "Classificações utilizadas nos contratos.",
  },
  slas: {
    path: "/settings/catalogs/slas",
    module: "slas",
    label: "SLAs",
    description: "Prazos e níveis de serviço do atendimento.",
  },
  canned: {
    path: "/settings/catalogs/canned-responses",
    module: "respostas_padrao",
    label: "Respostas Padrão",
    description: "Mensagens reutilizáveis para o atendimento.",
  },
  stickers: {
    path: "/settings/catalogs/stickers",
    module: "figurinhas",
    label: "Figurinhas",
    description: "Biblioteca de figurinhas das conversas.",
  },
  channels: {
    path: "/settings/integrations/channels",
    module: "canais",
    label: "Canais",
    description: "Conexões de e-mail, WhatsApp e canais de saída.",
  },
  automations: {
    path: "/settings/integrations/automations",
    module: "automacoes",
    label: "Automações",
    description: "Regras automáticas e fluxos de atendimento.",
  },
  users: {
    path: "/settings/access/users",
    module: "usuarios",
    label: "Usuários",
    description: "Convites, perfis e situação dos usuários.",
  },
  roles: {
    path: "/settings/access/roles",
    module: "papeis",
    label: "Papéis",
    description: "Perfis de acesso e permissões de cada papel.",
  },
  "user-permissions": {
    path: "/settings/access/permissions",
    module: "permissoes",
    label: "Permissões",
    description: "Permissões efetivas e exceções por usuário.",
  },
} as const;

export type SettingsSectionKey = keyof typeof SETTINGS_SECTIONS;
export type SettingsNode =
  SettingsSectionKey | { id: string; label: string; children: readonly SettingsNode[] };

export const SETTINGS_NAVIGATION: readonly SettingsNode[] = [
  "company",
  {
    id: "financial",
    label: "Parâmetros financeiros",
    children: [
      "financial",
      "operating-companies",
      { id: "banking", label: "Integrações bancárias", children: ["inter"] },
    ],
  },
  {
    id: "catalogs",
    label: "Cadastros",
    children: [
      "departments",
      "service-families",
      "provided-services",
      "contract-types",
      "slas",
      "canned",
      "stickers",
    ],
  },
  { id: "integrations", label: "Integrações", children: ["channels", "automations"] },
  { id: "access", label: "Permissões e acessos", children: ["users", "roles", "user-permissions"] },
];

/** Shared by the menu, directory and page guard. Group labels grant no access. */
export function canAccessSettingsSection(
  key: SettingsSectionKey,
  hasView: (module: string) => boolean,
): boolean {
  const section = SETTINGS_SECTIONS[key];
  return (
    hasView("configuracoes") &&
    hasView(section.module) &&
    (!("requires" in section) || section.requires.every(hasView))
  );
}

export function visibleSettingsNavigation(
  hasView: (module: string) => boolean,
  nodes = SETTINGS_NAVIGATION,
): SettingsNode[] {
  return nodes.flatMap((node): SettingsNode[] => {
    if (typeof node === "string") return canAccessSettingsSection(node, hasView) ? [node] : [];
    const children = visibleSettingsNavigation(hasView, node.children);
    return children.length ? [{ ...node, children }] : [];
  });
}

export function settingsSectionForPath(pathname: string): SettingsSectionKey | undefined {
  return (Object.keys(SETTINGS_SECTIONS) as SettingsSectionKey[]).find(
    (key) => SETTINGS_SECTIONS[key].path === pathname.replace(/\/$/, ""),
  );
}

export function settingsTrail(key: SettingsSectionKey, nodes = SETTINGS_NAVIGATION): string[] {
  for (const node of nodes) {
    if (node === key) return [SETTINGS_SECTIONS[key].label];
    if (typeof node !== "string") {
      const trail = settingsTrail(key, node.children);
      if (trail.length) return [node.label, ...trail];
    }
  }
  return [];
}
