import type { ComponentType } from "react";
import { EmptyStub } from "@/components/empty-stub";
import { ModulePermissionProvider } from "@/lib/permission-ui";
import { usePermissions } from "@/lib/use-permissions";
import {
  canAccessSettingsSection,
  SETTINGS_SECTIONS,
  type SettingsSectionKey,
} from "@/lib/settings-navigation";
import { CompanyTab } from "./CompanyTab";
import { OperatingCompaniesTab } from "./OperatingCompaniesTab";
import { InterTab } from "./InterTab";
import { FinancialTab } from "./FinancialTab";
import { AutomationsTab } from "./AutomationsTab";
import {
  UsersTab,
  RolesTab,
  UserPermissionsTab,
  DepartmentsTab,
  ServiceFamiliesTab,
  ProvidedServicesTab,
  ContractTypesTab,
  SlasTab,
  CannedTab,
  StickersTab,
  ChannelsTab,
} from "./settings-sections";

const COMPONENTS = {
  company: CompanyTab,
  financial: FinancialTab,
  "operating-companies": OperatingCompaniesTab,
  inter: InterTab,
  users: UsersTab,
  roles: RolesTab,
  "user-permissions": UserPermissionsTab,
  departments: DepartmentsTab,
  "service-families": ServiceFamiliesTab,
  "provided-services": ProvidedServicesTab,
  "contract-types": ContractTypesTab,
  slas: SlasTab,
  canned: CannedTab,
  stickers: StickersTab,
  channels: ChannelsTab,
  automations: AutomationsTab,
} satisfies Record<SettingsSectionKey, ComponentType>;

export function SettingsSection({ section }: { section: SettingsSectionKey }) {
  const permissions = usePermissions();
  if (permissions.loading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!canAccessSettingsSection(section, (module) => permissions.has(module, "view"))) {
    return (
      <EmptyStub
        title="Sem acesso"
        message="Você não tem permissão para acessar esta configuração."
      />
    );
  }
  const Component = COMPONENTS[section];
  return (
    <ModulePermissionProvider module={SETTINGS_SECTIONS[section].module}>
      <Component />
    </ModulePermissionProvider>
  );
}
